import { prisma } from "./db"
import { PartOfDay } from "@prisma/client"
import { startOfYearUTC } from "./date-format"
import { sumGrantTotal, isAnnualLeaveTypeName } from "./annual-grant-calc"

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

// 同一天時段是否衝突。上半天與下半天可並存；全天佔滿兩個時段。
// 不用「整天加總 > 1」當唯一條件：兩張上半天會是 0.5+0.5=1，加總不會擋，但時段已重複。
export function partsOfDayConflict(a: PartOfDay, b: PartOfDay): boolean {
  if (a === "ALL_DAY" || b === "ALL_DAY") return true
  return a === b
}

// 申請頁假別下拉：特休釘在第一（沒額度也仍當預設，因為表單用 [0]）。其餘維持原相對順序。
export function pinAnnualLeaveFirst<T extends { name: string }>(items: T[]): T[] {
  const annual: T[] = []
  const rest: T[] = []
  for (const item of items) {
    if (item.name.includes("特休") || item.name.toLowerCase().includes("annual")) {
      annual.push(item)
    } else {
      rest.push(item)
    }
  }
  return [...annual, ...rest]
}

// 判斷「某一天」是不是台北時區的上班日。
// 規則須與 calculateDurationDays 內的逐日判斷保持一致：
//   預設六日為非工作日；若 Holiday 表有該日，用 isWorkDay 覆蓋（補班日 true、國定假日 false）。
// 用於每日提醒 cron：非工作日整支跳過，不推播。
export async function isTaipeiWorkDay(date: Date): Promise<boolean> {
  const day = new Date(date)
  day.setUTCHours(0, 0, 0, 0)

  // date 有 @unique，用 findMany 取單筆以沿用既有測試 mock（與 calculateDurationDays 一致）
  const holidays = await prisma.holiday.findMany({ where: { date: day } })
  if (holidays.length > 0) {
    return holidays[0].isWorkDay // 補班日 true / 國定假日 false
  }

  const dayOfWeek = day.getUTCDay() // 0 = 週日, 6 = 週六
  return dayOfWeek !== 0 && dayOfWeek !== 6
}

// 勞基法 §38 特休對照表（來源：2017 修正版本 + HR 2026-05-18 確認）
// 僅在年資 >= 2 時被呼叫（年資 0~1 走公司前 2 年政策）
export function getStatutoryAnnualDays(seniorityYears: number): number {
  if (seniorityYears < 2) return 0           // 不會走到（安全 fallback）
  if (seniorityYears < 3) return 10          // 滿 2 年
  if (seniorityYears < 5) return 14          // 3-4 年
  if (seniorityYears < 10) return 15         // 5-9 年
  if (seniorityYears >= 25) return 30        // 25 年起封頂
  return Math.min(15 + (seniorityYears - 9), 30)  // 10→16, 11→17, ..., 24→30
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

export async function getUserLeaveBalance(
  userId: string,
  leaveTypeId: string,
  asOf: Date = new Date()
): Promise<{ total: number, used: number, pending: number, pendingFirst: number, pendingSecond: number, remaining: number }> {
  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId }});
  if (!leaveType) throw new Error("Leave type not found");

  const isAnnualLeave = isAnnualLeaveTypeName(leaveType.name);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  if (isAnnualLeave) {
    if (!user.hireDate) {
      return { total: 0, used: 0, pending: 0, pendingFirst: 0, pendingSecond: 0, remaining: 0 };
    }
    const grants = await prisma.annualLeaveGrant.findMany({
      where: { userId, voidedAt: null },
      select: { kind: true, effectiveAt: true, amount: true, year: true },
    })
    const total = sumGrantTotal(grants, asOf)
    const opening = grants.find((g) => g.kind === "OPENING")

    // 已用 / 待審：截止日 = asOf 所屬年度 12/31；有期初時只算期初日之後（與遷移前相同）
    const endOfYear = new Date(Date.UTC(asOf.getUTCFullYear(), 11, 31, 23, 59, 59, 999))
    const startFilter = opening ? { gte: opening.effectiveAt, lte: endOfYear } : { lte: endOfYear }
    const [usedAgg, pendingAgg, pendingSecondAgg] = await Promise.all([
      prisma.leaveRequest.aggregate({ _sum: { durationDays: true }, where: { userId, leaveTypeId, status: "APPROVED", startDate: startFilter } }),
      prisma.leaveRequest.aggregate({ _sum: { durationDays: true }, where: { userId, leaveTypeId, status: "PENDING", startDate: startFilter } }),
      prisma.leaveRequest.aggregate({ _sum: { durationDays: true }, where: { userId, leaveTypeId, status: "PENDING", firstApprovedAt: { not: null }, startDate: startFilter } }),
    ])
    const used = usedAgg._sum.durationDays || 0
    const pending = pendingAgg._sum.durationDays || 0
    const pendingSecond = pendingSecondAgg._sum.durationDays || 0
    return { total, used, pending, pendingFirst: pending - pendingSecond, pendingSecond, remaining: total - used - pending }
  }

  // 非特休：曆年制（每年 1/1 reset，不分有無 hireDate）
  // override 分水嶺式（sticky，year = 曆年）：取 year <= 當前曆年 的最大 row，沿用到下次設定為止
  const year = asOf.getUTCFullYear()
  const periodStart = startOfYearUTC(year)
  const periodEnd = startOfYearUTC(year + 1)

  const allOverrides = await prisma.userLeaveBalance.findMany({
    where: { userId, leaveTypeId },
    orderBy: { year: 'asc' },
    select: { year: true, totalQuota: true }
  })
  let stickyOverride: number | null = null
  for (const o of allOverrides) {
    if (o.year <= year) stickyOverride = o.totalQuota
    else break
  }
  const totalQuota = stickyOverride ?? leaveType.defaultDays

  // used / pending 只算當前曆年內 [periodStart, periodEnd)
  const [used, pending, pendingSecondAgg] = await Promise.all([
    prisma.leaveRequest.aggregate({
      _sum: { durationDays: true },
      where: { userId, leaveTypeId, status: "APPROVED", startDate: { gte: periodStart, lt: periodEnd } }
    }),
    prisma.leaveRequest.aggregate({
      _sum: { durationDays: true },
      where: { userId, leaveTypeId, status: "PENDING", startDate: { gte: periodStart, lt: periodEnd } }
    }),
    prisma.leaveRequest.aggregate({
      _sum: { durationDays: true },
      where: { userId, leaveTypeId, status: "PENDING", firstApprovedAt: { not: null }, startDate: { gte: periodStart, lt: periodEnd } }
    })
  ])
  const usedDays = used._sum.durationDays || 0
  const pendingDays = pending._sum.durationDays || 0
  const pendingSecondDays = pendingSecondAgg._sum.durationDays || 0
  return { total: totalQuota, used: usedDays, pending: pendingDays, pendingFirst: pendingDays - pendingSecondDays, pendingSecond: pendingSecondDays, remaining: totalQuota - usedDays - pendingDays }
}

// 跨年重複花額度檢查：把「這張新單」加進去後，從請假年度到最遠一張已預約假單的年度，
// 每年 12/31 的累計剩餘都不可為負。回傳第一個不足的年度，足夠則 null。
export async function findAnnualShortfall(
  userId: string,
  leaveTypeId: string,
  extra: { startDate: Date; days: number },
  excludeRequestId?: string,
): Promise<{ year: number; remaining: number } | null> {
  const grants = await prisma.annualLeaveGrant.findMany({
    where: { userId, voidedAt: null },
    select: { kind: true, effectiveAt: true, amount: true, year: true },
  })
  const opening = grants.find((g) => g.kind === "OPENING")
  const requests = await prisma.leaveRequest.findMany({
    where: {
      userId, leaveTypeId, status: { in: ["APPROVED", "PENDING"] },
      ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      ...(opening ? { startDate: { gte: opening.effectiveAt } } : {}),
    },
    select: { id: true, startDate: true, durationDays: true },
  })
  const all = [...requests.map((r) => ({ startDate: r.startDate, days: r.durationDays })), extra]
  const fromYear = extra.startDate.getUTCFullYear()
  const toYear = Math.max(fromYear, ...all.map((r) => r.startDate.getUTCFullYear()))
  for (let year = fromYear; year <= toYear; year++) {
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
    const total = sumGrantTotal(grants, yearEnd)
    const spent = all.filter((r) => r.startDate <= yearEnd).reduce((n, r) => n + r.days, 0)
    if (total - spent < 0) return { year, remaining: total - spent }
  }
  return null
}
