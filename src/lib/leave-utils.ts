import { prisma } from "./db"
import { PartOfDay } from "@prisma/client"
import { startOfYearUTC } from "./date-format"

// 一律以 UTC 解讀日期，避免伺服器時區（UTC vs UTC+8）造成國定假日比對位移
function formatUTCDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export async function calculateDurationDays(startDate: Date, endDate: Date, partOfDay: PartOfDay): Promise<number> {
  // Get all holidays between startDate and endDate
  const holidays = await prisma.holiday.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate,
      }
    }
  });

  const holidayMap = new Map(holidays.map(h => [formatUTCDate(h.date), h.isWorkDay]));

  let workDays = 0;
  let currentDate = new Date(startDate);
  currentDate.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);

  while (currentDate <= end) {
    const dateStr = formatUTCDate(currentDate);
    const dayOfWeek = currentDate.getUTCDay(); // 0 is Sunday, 6 is Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let isWorkDayThisDay = !isWeekend;

    if (holidayMap.has(dateStr)) {
      isWorkDayThisDay = holidayMap.get(dateStr)!; // Override with holiday/make-up day rule
    }

    if (isWorkDayThisDay) {
      workDays++;
    }

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  if (workDays === 0) return 0;

  if (partOfDay !== "ALL_DAY" && workDays === 1) {
    return 0.5;
  }

  return workDays;
}

// 勞基法 §38 特休對照表（來源：2017 修正版本 + HR 2026-05-18 確認）
// 僅在年資 >= 2 時被呼叫（年資 0~1 走公司前 2 年政策，由 getAnniversaryBaseDays 處理）
export function getStatutoryAnnualDays(seniorityYears: number): number {
  if (seniorityYears < 2) return 0           // 不會走到（安全 fallback）
  if (seniorityYears < 3) return 10          // 滿 2 年
  if (seniorityYears < 5) return 14          // 3-4 年
  if (seniorityYears < 10) return 15         // 5-9 年
  if (seniorityYears >= 25) return 30        // 25 年起封頂
  return Math.min(15 + (seniorityYears - 9), 30)  // 10→16, 11→17, ..., 24→30
}

// 第 N 個週年期應給的基準天數（不含 override 比較）
// 第 N 週年期 = [hireDate + (N-1) 年, hireDate + N 年)，期間開始時員工年資 = N - 1
// 公司前 2 年（N=1, N=2）走 leaveType.defaultDays；之後走政府表
export function getAnniversaryBaseDays(N: number, leaveTypeDefaultDays: number): number {
  const seniorityAtStart = N - 1
  if (seniorityAtStart < 2) return leaveTypeDefaultDays
  return getStatutoryAnnualDays(seniorityAtStart)
}

// 計算 start → end 的「完整月份數」（floor）
// 例：2024-05-13 → 2024-08-13 = 3 個月；→ 2024-08-12 = 2 個月
export function monthsBetween(start: Date, end: Date): number {
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12
              + (end.getUTCMonth() - start.getUTCMonth())
  if (end.getUTCDate() < start.getUTCDate()) months -= 1
  return Math.max(0, months)
}

// 計算「截至 asOf」的累計特休總額（分水嶺式 override）
// overrides 必須已 ORDER BY year ASC
export function calcAnnualLeaveCumulative(
  hireDate: Date,
  asOf: Date,
  leaveTypeDefaultDays: number,
  overrides: { year: number; totalQuota: number }[]
): number {
  const M = monthsBetween(hireDate, asOf)
  if (M < 3) return 0   // gate：未滿 3 個月不可請

  // 「完整 + 進行中」的週年期數 = floor(M/12) + 1
  // M=3 → maxN=1（在第 1 期），M=12 → maxN=2（剛進入第 2 期），M=24 → maxN=3
  const maxN = Math.floor(M / 12) + 1
  const hireYear = hireDate.getUTCFullYear()

  let total = 0
  for (let N = 1; N <= maxN; N++) {
    const base = getAnniversaryBaseDays(N, leaveTypeDefaultDays)
    const anniversaryStartYear = hireYear + (N - 1)

    // 分水嶺：對該週年期，找 year <= anniversaryStartYear 的最大 year override
    let applicable: number | null = null
    for (const o of overrides) {
      if (o.year <= anniversaryStartYear) applicable = o.totalQuota
      else break   // 已 sort 過，超過就停
    }

    total += applicable !== null ? Math.max(base, applicable) : base
  }
  return total
}

export async function getUserLeaveBalance(
  userId: string,
  leaveTypeId: string,
  asOf: Date = new Date()
): Promise<{ total: number, used: number, pending: number, remaining: number }> {
  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId }});
  if (!leaveType) throw new Error("Leave type not found");

  const isAnnualLeave = leaveType.name.includes("特休") || leaveType.name.toLowerCase().includes("annual");

  if (isAnnualLeave) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    // 特休一定要有到職日才能算（不可 fallback 到 createdAt，避免老員工被誤算）
    if (!user.hireDate) {
      return { total: 0, used: 0, pending: 0, remaining: 0 };
    }

    // 取所有 override（asc by year，calc 函數做分水嶺挑選）
    const overrides = await prisma.userLeaveBalance.findMany({
      where: { userId, leaveTypeId },
      orderBy: { year: 'asc' },
      select: { year: true, totalQuota: true }
    })

    const total = calcAnnualLeaveCumulative(
      user.hireDate, asOf, leaveType.defaultDays, overrides
    )

    // 已用 / 待審：截至 asOf 的所有時間累計（不分年度切割）
    const [usedAgg, pendingAgg] = await Promise.all([
      prisma.leaveRequest.aggregate({
        _sum: { durationDays: true },
        where: { userId, leaveTypeId, status: "APPROVED", startDate: { lte: asOf } }
      }),
      prisma.leaveRequest.aggregate({
        _sum: { durationDays: true },
        where: { userId, leaveTypeId, status: "PENDING", startDate: { lte: asOf } }
      })
    ])

    const used = usedAgg._sum.durationDays || 0
    const pending = pendingAgg._sum.durationDays || 0

    return { total, used, pending, remaining: total - used - pending }
  }

  // 非特休：維持曆年制（病假、事假等每年重置）
  const year = asOf.getUTCFullYear()
  let totalQuota = leaveType.defaultDays

  const override = await prisma.userLeaveBalance.findUnique({
    where: { userId_leaveTypeId_year: { userId, leaveTypeId, year } }
  });

  if (override) {
    totalQuota = override.totalQuota;
  }

  const usedLeaves = await prisma.leaveRequest.aggregate({
    _sum: { durationDays: true },
    where: {
      userId,
      leaveTypeId,
      status: "APPROVED",
      startDate: {
        gte: startOfYearUTC(year),
        lt: startOfYearUTC(year + 1)
      }
    }
  });

  const pendingLeaves = await prisma.leaveRequest.aggregate({
    _sum: { durationDays: true },
    where: {
      userId,
      leaveTypeId,
      status: "PENDING",
      startDate: {
        gte: startOfYearUTC(year),
        lt: startOfYearUTC(year + 1)
      }
    }
  });

  const used = usedLeaves._sum.durationDays || 0;
  const pending = pendingLeaves._sum.durationDays || 0;

  return {
    total: totalQuota,
    used,
    pending,
    remaining: totalQuota - used - pending
  };
}
