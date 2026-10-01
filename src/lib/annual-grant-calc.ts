import { getStatutoryAnnualDays, monthsBetween } from "./leave-utils"

// 特休發放的純計算。公式只存在這裡，且只在「寫入發放紀錄當下」被呼叫。

export type GrantBasis = { rule: string; text: string; [k: string]: string | number }
export type GrantCalc = { amount: number; basis: GrantBasis }
export type Override = { year: number; totalQuota: number }
export type GrantLike = { kind: string; effectiveAt: Date; amount: number }

// 捨去到 0.5；加極小值避免 2.9999999 這類浮點誤差被捨成 2.5
export function floorToHalf(n: number): number {
  return Math.floor(n * 2 + 1e-9) / 2
}

// 剩餘完整月數：1 號到職算當月；其他日期從下個月起算
export function remainingFullMonths(hireDate: Date): number {
  const m = hireDate.getUTCMonth()
  return hireDate.getUTCDate() === 1 ? 12 - m : 11 - m
}

// 發放當下使用的到職日（YYYY-MM-DD）。存進 basis，之後用來判斷「到職日是否變過、需不需要重算」
export const isoDate = (d: Date) => d.toISOString().slice(0, 10)

// 首年按比例（A 算法，HR 2026-10-01 確認）
export function calcProRataGrant(hireDate: Date, defaultDays: number): GrantCalc {
  const months = remainingFullMonths(hireDate)
  const amount = floorToHalf((months / 12) * defaultDays)
  return {
    amount,
    basis: {
      rule: "PRORATA_MONTHS_V1",
      hireDate: isoDate(hireDate),
      months,
      defaultDays,
      text: `到職首年：剩 ${months} 個月 × ${defaultDays} ÷ 12 → ${amount} 天`,
    },
  }
}

// 年度發放：以 year-01-01 的完整年資；<2 年 = defaultDays，>=2 年 = 勞基法 §38；override 取大
export function calcAnnualGrant(hireDate: Date, year: number, defaultDays: number, overrides: Override[]): GrantCalc {
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const completedYears = Math.floor(monthsBetween(hireDate, jan1) / 12)
  const base = completedYears < 2 ? defaultDays : getStatutoryAnnualDays(completedYears)

  let override: number | null = null
  for (const o of overrides) {
    if (o.year <= year) override = o.totalQuota
    else break
  }
  const amount = override !== null ? Math.max(base, override) : base

  let text = completedYears < 2
    ? `${year} 年度特休：年資 ${completedYears} 年（未滿 2 年依公司規定）→ ${base} 天`
    : `${year} 年度特休：滿 ${completedYears} 年，依勞基法 §38 → ${base} 天`
  if (override !== null) text += `；個人額度 ${override} 天，取較大者 → ${amount} 天`

  const basis: GrantBasis = { rule: "ANNUAL_V1", hireDate: isoDate(hireDate), completedYears, base, text }
  if (override !== null) basis.override = override
  return { amount, basis }
}

// 不符年度發放資格的原因；符合回 null
export function annualIneligibleReason(
  u: { hireDate: Date | null; terminatedDate: Date | null },
  year: number,
): string | null {
  if (!u.hireDate) return "沒有到職日"
  if (u.hireDate.getUTCFullYear() >= year) return "到職年即發放年，已由首年按比例發放"
  const jan1 = new Date(Date.UTC(year, 0, 1))
  // terminatedDate = 離職日，自該日起視為離職
  if (u.terminatedDate && u.terminatedDate <= jan1) return "發放日前已離職"
  return null
}

// 目前開放到哪一年：12/1（台北）起開放明年
export function openYearFor(todayTaipei: Date): number {
  const y = todayTaipei.getUTCFullYear()
  return todayTaipei.getUTCMonth() === 11 ? y + 1 : y
}

// HR 按鈕可發的年度：今年、明年
export function allowedGrantYears(todayTaipei: Date): number[] {
  const y = todayTaipei.getUTCFullYear()
  return [y, y + 1]
}

export function periodKey(kind: "PRORATA" | "ANNUAL", year: number): string {
  return `${kind}:${year}`
}

// 特休總額（只傳入未作廢的紀錄）。
// 有期初：期初一律計入（與舊公式一致），其他紀錄只算「期初日之後、且生效日 <= asOf」。
// 無期初：生效日 <= asOf 的全部加總。
export function sumGrantTotal(activeGrants: GrantLike[], asOf: Date): number {
  const opening = activeGrants.find((g) => g.kind === "OPENING")
  let total = 0
  for (const g of activeGrants) {
    if (g.kind === "OPENING") continue
    if (g.effectiveAt > asOf) continue
    if (opening && g.effectiveAt <= opening.effectiveAt) continue
    total += g.amount
  }
  return opening ? opening.amount + total : total
}

export function isAnnualLeaveTypeName(name: string): boolean {
  return name.includes("特休") || name.toLowerCase().includes("annual")
}
