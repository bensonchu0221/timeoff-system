import { describe, it, expect, vi } from "vitest"

vi.mock("./db", () => ({ prisma: {} }))

import {
  floorToHalf, remainingFullMonths, calcProRataGrant, calcAnnualGrant,
  annualIneligibleReason, openYearFor, allowedGrantYears, periodKey, sumGrantTotal,
} from "./annual-grant-calc"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe("calcProRataGrant（A 算法：剩餘完整月數 ÷ 12 × 10，捨去到 0.5）", () => {
  it.each([
    ["2026-01-01", 12, 10],
    ["2026-01-02", 11, 9],
    ["2026-06-15", 6, 5],
    ["2026-08-24", 4, 3],   // Sophia
    ["2026-10-01", 3, 2.5], // Aaron
    ["2026-12-01", 1, 0.5],
    ["2026-12-02", 0, 0],
    ["2028-02-29", 10, 8],  // 閏年 2/29（非 1 號 → 從 3 月起算 10 個月 → 8.33 → 8）
  ])("到職 %s → 剩 %i 個月 → %f 天", (hire, months, amount) => {
    expect(remainingFullMonths(d(hire))).toBe(months)
    const r = calcProRataGrant(d(hire), 10)
    expect(r.amount).toBe(amount)
    expect(r.basis.rule).toBe("PRORATA_MONTHS_V1")
    expect(r.basis.months).toBe(months)
    expect(r.basis.text).toBe(`到職首年：剩 ${months} 個月 × 10 ÷ 12 → ${amount} 天`)
  })
})

describe("floorToHalf", () => {
  it("捨去到 0.5，浮點誤差不吃掉整數", () => {
    expect(floorToHalf(3.33)).toBe(3)
    expect(floorToHalf(2.5)).toBe(2.5)
    expect(floorToHalf(7 / 12 * 12)).toBe(7)
  })
})

describe("calcAnnualGrant", () => {
  it.each([
    ["2025-03-01", 2027, 1, 10],  // 未滿 2 年 → defaultDays
    ["2024-08-14", 2027, 2, 10],  // 滿 2 年 → §38 10
    ["2023-08-14", 2027, 3, 14],  // 林仲軍：滿 3 年 → 14
    ["2021-12-31", 2027, 5, 15],
    ["2017-01-01", 2027, 10, 16],
    ["2000-01-01", 2027, 27, 30], // 25 年起封頂
  ])("到職 %s，%i 年 1/1 年資 %i → %f 天", (hire, year, yrs, amount) => {
    const r = calcAnnualGrant(d(hire), year, 10, [])
    expect(r.amount).toBe(amount)
    expect(r.basis.completedYears).toBe(yrs)
  })

  it("2/29 到職：隔年 1/1 年資用完整月數計算", () => {
    expect(calcAnnualGrant(d("2024-02-29"), 2027, 10, []).basis.completedYears).toBe(2)
  })

  it("override 取較大者，且只適用 year <= 發放年", () => {
    const ov = [{ year: 2026, totalQuota: 12 }, { year: 2028, totalQuota: 20 }]
    const r = calcAnnualGrant(d("2025-03-01"), 2027, 10, ov)
    expect(r.amount).toBe(12)
    expect(r.basis.text).toContain("個人額度 12 天，取較大者 → 12 天")
    expect(calcAnnualGrant(d("2023-08-14"), 2027, 10, [{ year: 2027, totalQuota: 12 }]).amount).toBe(14)
  })
})

describe("annualIneligibleReason", () => {
  it("沒有到職日", () => expect(annualIneligibleReason({ hireDate: null, terminatedDate: null }, 2027)).toBe("沒有到職日"))
  it("到職年 = 發放年（走首年）", () =>
    expect(annualIneligibleReason({ hireDate: d("2027-03-01"), terminatedDate: null }, 2027)).toBe("到職年即發放年，已由首年按比例發放"))
  it("離職日剛好 1/1 → 不發", () =>
    expect(annualIneligibleReason({ hireDate: d("2020-01-01"), terminatedDate: d("2027-01-01") }, 2027)).toBe("發放日前已離職"))
  it("離職日 1/2 → 發", () =>
    expect(annualIneligibleReason({ hireDate: d("2020-01-01"), terminatedDate: d("2027-01-02") }, 2027)).toBeNull())
})

describe("openYearFor / allowedGrantYears", () => {
  it("11/30 開放到今年；12/1 起開放到明年", () => {
    expect(openYearFor(d("2026-11-30"))).toBe(2026)
    expect(openYearFor(d("2026-12-01"))).toBe(2027)
  })
  it("HR 只能發今年或明年", () => expect(allowedGrantYears(d("2026-10-01"))).toEqual([2026, 2027]))
})

describe("periodKey", () => {
  it("格式", () => expect(periodKey("ANNUAL", 2027)).toBe("ANNUAL:2027"))
})

describe("sumGrantTotal", () => {
  const g = (kind: string, iso: string, amount: number) => ({ kind, effectiveAt: d(iso), amount })

  it("無期初：生效日 <= asOf 才計入", () => {
    const grants = [g("PRORATA", "2026-10-01", 2.5), g("ANNUAL", "2027-01-01", 10), g("ADJUSTMENT", "2026-11-01", -1)]
    expect(sumGrantTotal(grants, d("2026-09-30"))).toBe(0)
    expect(sumGrantTotal(grants, d("2026-12-31"))).toBe(1.5)
    expect(sumGrantTotal(grants, d("2027-01-01"))).toBe(11.5)
  })

  it("有期初：期初一律計入（與舊公式一致），其他只算期初日之後", () => {
    const grants = [g("OPENING", "2026-01-01", 12), g("ADJUSTMENT", "2026-01-01", 3), g("ADJUSTMENT", "2026-10-01", 4), g("ANNUAL", "2027-01-01", 14)]
    expect(sumGrantTotal(grants, d("2025-12-31"))).toBe(12)
    expect(sumGrantTotal(grants, d("2026-10-01"))).toBe(16)
    expect(sumGrantTotal(grants, d("2027-01-01"))).toBe(30)
  })
})
