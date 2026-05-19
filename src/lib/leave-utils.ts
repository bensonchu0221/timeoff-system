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
  const currentDate = new Date(startDate);
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

// 加 N 年（保持同月同日，以 UTC 為準）
// 邊界：2/29 → 隔年 3/1 (Date 自動處理)
export function addYearsUTC(d: Date, years: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear() + years, d.getUTCMonth(), d.getUTCDate()))
}

// 計算「截至 asOf」的累計特休總額（分水嶺式 override + 可選 opening）
// overrides 必須已 ORDER BY year ASC
// opening 存在時：累計從 opening.balance 起算、只加 opening.at 之後的週年發放
export function calcAnnualLeaveCumulative(
  hireDate: Date,
  asOf: Date,
  leaveTypeDefaultDays: number,
  overrides: { year: number; totalQuota: number }[],
  opening?: { balance: number; at: Date }
): number {
  const M = monthsBetween(hireDate, asOf)
  const hireYear = hireDate.getUTCFullYear()

  // 有 opening：從 opening.balance 起算，只加 openingAt 之後到 asOf 之前的週年發放
  if (opening) {
    let total = opening.balance
    if (M < 0) return total   // asOf < hireDate（理論不應發生）
    const maxN = Math.floor(M / 12) + 1
    for (let N = 1; N <= maxN; N++) {
      const grantDate = addYearsUTC(hireDate, N - 1)
      // 只算 opening.at < grantDate <= asOf 的週年期
      if (grantDate > opening.at && grantDate <= asOf) {
        const base = getAnniversaryBaseDays(N, leaveTypeDefaultDays)
        const anniversaryStartYear = hireYear + (N - 1)
        let applicable: number | null = null
        for (const o of overrides) {
          if (o.year <= anniversaryStartYear) applicable = o.totalQuota
          else break
        }
        total += applicable !== null ? Math.max(base, applicable) : base
      }
    }
    return total
  }

  // 無 opening：原邏輯（從 hireDate 累計）
  const maxN = Math.floor(M / 12) + 1
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

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  if (isAnnualLeave) {
    // 特休一定要有到職日才能算
    if (!user.hireDate) {
      return { total: 0, used: 0, pending: 0, remaining: 0 };
    }

    // 取所有 override（asc by year，calc 函數做分水嶺挑選）
    const overrides = await prisma.userLeaveBalance.findMany({
      where: { userId, leaveTypeId },
      orderBy: { year: 'asc' },
      select: { year: true, totalQuota: true }
    })

    // 組裝 opening（兩個欄位同存才有效）
    const opening = (user.annualLeaveOpeningBalance !== null && user.annualLeaveOpeningAt !== null)
      ? { balance: user.annualLeaveOpeningBalance, at: user.annualLeaveOpeningAt }
      : undefined

    const total = calcAnnualLeaveCumulative(
      user.hireDate, asOf, leaveType.defaultDays, overrides, opening
    )

    // 已用 / 待審：opening 存在時從 openingAt 起算；否則從入職以來累計
    const startFilter = opening ? { gte: opening.at, lte: asOf } : { lte: asOf }
    const [usedAgg, pendingAgg] = await Promise.all([
      prisma.leaveRequest.aggregate({
        _sum: { durationDays: true },
        where: { userId, leaveTypeId, status: "APPROVED", startDate: startFilter }
      }),
      prisma.leaveRequest.aggregate({
        _sum: { durationDays: true },
        where: { userId, leaveTypeId, status: "PENDING", startDate: startFilter }
      })
    ])

    const used = usedAgg._sum.durationDays || 0
    const pending = pendingAgg._sum.durationDays || 0

    return { total, used, pending, remaining: total - used - pending }
  }

  // 非特休：以 hireDate 為基準的週年制（每期 reset）
  // 沒 hireDate 的員工 → fallback 走原曆年制（保留向後相容；admin 應補 hireDate）
  if (!user.hireDate) {
    const year = asOf.getUTCFullYear()
    let totalQuota = leaveType.defaultDays
    const override = await prisma.userLeaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId, year } }
    })
    if (override) totalQuota = override.totalQuota

    const [usedY, pendingY] = await Promise.all([
      prisma.leaveRequest.aggregate({
        _sum: { durationDays: true },
        where: {
          userId, leaveTypeId, status: "APPROVED",
          startDate: { gte: startOfYearUTC(year), lt: startOfYearUTC(year + 1) }
        }
      }),
      prisma.leaveRequest.aggregate({
        _sum: { durationDays: true },
        where: {
          userId, leaveTypeId, status: "PENDING",
          startDate: { gte: startOfYearUTC(year), lt: startOfYearUTC(year + 1) }
        }
      })
    ])
    const usedDays = usedY._sum.durationDays || 0
    const pendingDays = pendingY._sum.durationDays || 0
    return { total: totalQuota, used: usedDays, pending: pendingDays, remaining: totalQuota - usedDays - pendingDays }
  }

  // 有 hireDate：算當前所在週年期 [periodStart, periodEnd)
  const M = monthsBetween(user.hireDate, asOf)
  const N = Math.floor(M / 12) + 1
  const periodStart = addYearsUTC(user.hireDate, N - 1)
  const periodEnd = addYearsUTC(user.hireDate, N)

  // override 分水嶺式：找 year <= anniversaryStartYear 的最大 row
  const anniversaryStartYear = user.hireDate.getUTCFullYear() + (N - 1)
  const allOverrides = await prisma.userLeaveBalance.findMany({
    where: { userId, leaveTypeId },
    orderBy: { year: 'asc' },
    select: { year: true, totalQuota: true }
  })
  let stickyOverride: number | null = null
  for (const o of allOverrides) {
    if (o.year <= anniversaryStartYear) stickyOverride = o.totalQuota
    else break
  }
  const totalQuota = stickyOverride ?? leaveType.defaultDays

  // used / pending 只算當前週年期內
  const [used, pending] = await Promise.all([
    prisma.leaveRequest.aggregate({
      _sum: { durationDays: true },
      where: { userId, leaveTypeId, status: "APPROVED", startDate: { gte: periodStart, lt: periodEnd } }
    }),
    prisma.leaveRequest.aggregate({
      _sum: { durationDays: true },
      where: { userId, leaveTypeId, status: "PENDING", startDate: { gte: periodStart, lt: periodEnd } }
    })
  ])
  const usedDays = used._sum.durationDays || 0
  const pendingDays = pending._sum.durationDays || 0
  return { total: totalQuota, used: usedDays, pending: pendingDays, remaining: totalQuota - usedDays - pendingDays }
}
