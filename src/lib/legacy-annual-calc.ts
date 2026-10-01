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
