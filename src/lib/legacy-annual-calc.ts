import { prisma } from "./db"
import { getStatutoryAnnualDays, monthsBetween } from "./leave-utils"

// ⚠️ 舊版特休即時公式（2026-05-20 ~ 遷移前）。
// 只給：遷移回填、零差異審核報表、等價性測試使用。遷移穩定後（過完 2027/1/1）刪除。

function ceilToHalf(n: number): number {
  return Math.ceil(n * 2) / 2
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365
}

// hireDate（含當天）到隔年 1/1 的天數差（整數天）
// 例：2025-08-05 → 149 天；2025-12-31 → 1 天；2025-01-01 → 365 天
function daysFromHireToYearEnd(hireDate: Date): number {
  const nextYearStart = Date.UTC(hireDate.getUTCFullYear() + 1, 0, 1)
  return Math.round((nextYearStart - hireDate.getTime()) / 86_400_000)
}

// 計算「截至 asOf」的累計特休總額（曆年制：入職 pro-rata + 每年 1/1 grant + 手動調整）
// overrides 必須已 ORDER BY year ASC（year = 曆年，分水嶺式取 year <= calendarYear 的最大 totalQuota）
// adjustments = HR 手動調整（effectiveAt + amount，amount 可正可負）
// opening 存在時：從 opening.balance 起算、只加 opening.at 之後的 1/1 grant 與 adjustments
// 舊首年：剩餘天數 / 全年天數 × defaultDays，無條件進位到 0.5
export function legacyProRata(hireDate: Date, defaultDays: number) {
  const remainingDays = daysFromHireToYearEnd(hireDate)
  const yearTotal = daysInYear(hireDate.getUTCFullYear())
  return { amount: ceilToHalf((remainingDays / yearTotal) * defaultDays), remainingDays, yearTotal }
}

export function legacyCalcCalendarYearCumulative(
  hireDate: Date,
  asOf: Date,
  leaveTypeDefaultDays: number,
  overrides: { year: number; totalQuota: number }[],
  adjustments: { effectiveAt: Date; amount: number }[],
  opening?: { balance: number; at: Date }
): number {
  // 分水嶺式 override（year = 曆年）
  function resolveOverride(calendarYear: number): number | null {
    let applicable: number | null = null
    for (const o of overrides) {
      if (o.year <= calendarYear) applicable = o.totalQuota
      else break
    }
    return applicable
  }

  // 某 1/1 當天的發放額度（依年資 + override）
  function grantForJan1(year: number): number {
    const jan1 = new Date(Date.UTC(year, 0, 1))
    const completedYears = Math.floor(monthsBetween(hireDate, jan1) / 12)
    const base = completedYears < 2
      ? leaveTypeDefaultDays
      : getStatutoryAnnualDays(completedYears)
    const applicable = resolveOverride(year)
    return applicable !== null ? Math.max(base, applicable) : base
  }

  // ── 主邏輯：grants ──
  let total: number
  if (opening) {
    total = opening.balance
    let year = hireDate.getUTCFullYear() + 1
    // 上限：asOf 那年（不會無限跑）
    const stopYear = asOf.getUTCFullYear() + 1
    while (year < stopYear) {
      const jan1 = new Date(Date.UTC(year, 0, 1))
      if (jan1 > asOf) break
      if (jan1 > opening.at) {       // strictly greater → opening.at 當天的 grant 已含在 opening
        total += grantForJan1(year)
      }
      year++
    }
  } else {
    if (asOf < hireDate) return 0
    // 入職 pro-rata = (本年剩餘天數，含 hireDate 當天) / 該年總天數 × defaultDays
    const remainingDays = daysFromHireToYearEnd(hireDate)
    const yearTotal = daysInYear(hireDate.getUTCFullYear())
    total = ceilToHalf(remainingDays / yearTotal * leaveTypeDefaultDays)

    // 每年 1/1 grants
    let year = hireDate.getUTCFullYear() + 1
    const stopYear = asOf.getUTCFullYear() + 1
    while (year < stopYear) {
      const jan1 = new Date(Date.UTC(year, 0, 1))
      if (jan1 > asOf) break
      total += grantForJan1(year)
      year++
    }
  }

  // ── 手動調整（獨立於主邏輯，effectiveAt <= asOf 才計入）──
  for (const adj of adjustments) {
    if (adj.effectiveAt > asOf) continue
    if (opening && adj.effectiveAt <= opening.at) continue   // 已含在 opening 內
    total += adj.amount
  }

  return total
}

// 舊版 getUserLeaveBalance 特休分支的複製：讀舊欄位（User.annualLeaveOpening*）與舊 LeaveAdjustment 表。
export async function legacyAnnualBalance(userId: string, leaveTypeId: string, asOf: Date) {
  const leaveType = await prisma.leaveType.findUniqueOrThrow({ where: { id: leaveTypeId } })
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  if (!user.hireDate) return { total: 0, used: 0, pending: 0, remaining: 0 }
  const overrides = await prisma.userLeaveBalance.findMany({
    where: { userId, leaveTypeId }, orderBy: { year: "asc" }, select: { year: true, totalQuota: true },
  })
  const adjustments = await prisma.leaveAdjustment.findMany({
    where: { userId, leaveTypeId }, orderBy: { effectiveAt: "asc" }, select: { effectiveAt: true, amount: true },
  })
  const opening = user.annualLeaveOpeningBalance !== null && user.annualLeaveOpeningAt !== null
    ? { balance: user.annualLeaveOpeningBalance, at: user.annualLeaveOpeningAt } : undefined
  const total = legacyCalcCalendarYearCumulative(user.hireDate, asOf, leaveType.defaultDays, overrides, adjustments, opening)
  const endOfYear = new Date(Date.UTC(asOf.getUTCFullYear(), 11, 31, 23, 59, 59, 999))
  const startFilter = opening ? { gte: opening.at, lte: endOfYear } : { lte: endOfYear }
  const [u, p] = await Promise.all([
    prisma.leaveRequest.aggregate({ _sum: { durationDays: true }, where: { userId, leaveTypeId, status: "APPROVED", startDate: startFilter } }),
    prisma.leaveRequest.aggregate({ _sum: { durationDays: true }, where: { userId, leaveTypeId, status: "PENDING", startDate: startFilter } }),
  ])
  const used = u._sum.durationDays || 0
  const pending = p._sum.durationDays || 0
  return { total, used, pending, remaining: total - used - pending }
}

// 舊版 getLeaveLedger 特休分支的「發放類事件」（遷移前 ledger-utils.ts 的邏輯，純函式版）。
// 不含「滿 3 個月」0 天提示與請假事件。只給零差異審核比對歷史假單用。
export function legacyLedgerGrantEvents(input: {
  hireDate: Date | null
  opening: { balance: number; at: Date } | null
  overrides: { year: number; totalQuota: number }[]
  adjustments: { effectiveAt: Date; amount: number }[]
  defaultDays: number
  now: Date
}): { date: Date; amount: number }[] {
  const { hireDate, opening, overrides, adjustments, defaultDays, now } = input
  if (!hireDate) return []
  const events: { date: Date; amount: number }[] = []
  if (opening) {
    events.push({ date: opening.at, amount: opening.balance })
  } else {
    events.push({ date: hireDate, amount: legacyProRata(hireDate, defaultDays).amount })
  }
  for (let year = hireDate.getUTCFullYear() + 1; year < now.getUTCFullYear() + 1; year++) {
    const jan1 = new Date(Date.UTC(year, 0, 1))
    if (jan1 > now) break
    if (opening && jan1 <= opening.at) continue
    const completedYears = Math.floor(monthsBetween(hireDate, jan1) / 12)
    const base = completedYears < 2 ? defaultDays : getStatutoryAnnualDays(completedYears)
    let applicable: number | null = null
    for (const o of overrides) {
      if (o.year <= year) applicable = o.totalQuota
      else break
    }
    events.push({ date: jan1, amount: applicable !== null ? Math.max(base, applicable) : base })
  }
  for (const adj of adjustments) {
    if (opening && adj.effectiveAt <= opening.at) continue
    if (adj.effectiveAt > now) continue
    events.push({ date: adj.effectiveAt, amount: adj.amount })
  }
  return events
}
