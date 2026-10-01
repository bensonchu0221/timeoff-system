import { describe, it, expect, vi } from "vitest"

vi.mock("./db", () => ({ prisma: {} }))

import { buildBackfillRows } from "./backfill-plan"
import { legacyCalcCalendarYearCumulative } from "./legacy-annual-calc"
import { sumGrantTotal } from "./annual-grant-calc"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const NOW = d("2026-10-01")

// 合成員工：涵蓋有/無期初、各種到職日、override、手動調整（含期初日當天與之前）
const cases = [
  { name: "Sophia 型：今年到職無期初", hireDate: d("2026-08-24"), opening: null, overrides: [], adjustments: [] },
  { name: "Aaron 型：1 號到職", hireDate: d("2026-10-01"), opening: null, overrides: [], adjustments: [] },
  { name: "Ringo 型：1/1 到職", hireDate: d("2026-01-01"), opening: null, overrides: [], adjustments: [] },
  { name: "去年到職無期初", hireDate: d("2025-03-15"), opening: null, overrides: [], adjustments: [] },
  { name: "多年無期初 + override", hireDate: d("2021-07-01"), opening: null, overrides: [{ year: 2024, totalQuota: 18 }], adjustments: [] },
  {
    name: "林仲軍型：有期初 + 期初後調整",
    hireDate: d("2023-08-14"),
    opening: { balance: 12, at: d("2026-01-01") },
    overrides: [],
    adjustments: [{ effectiveAt: d("2026-10-01"), amount: 4, reason: "年資滿3年補滿14天特休", createdById: "hr" }],
  },
  {
    name: "期初當天與之前的調整不重複計",
    hireDate: d("2019-02-01"),
    opening: { balance: 20, at: d("2026-01-01") },
    overrides: [],
    adjustments: [
      { effectiveAt: d("2025-12-01"), amount: 2, reason: "x", createdById: "hr" },
      { effectiveAt: d("2026-01-01"), amount: 1, reason: "y", createdById: "hr" },
      { effectiveAt: d("2026-03-01"), amount: -1.5, reason: "z", createdById: "hr" },
    ],
  },
  { name: "未來生效的調整", hireDate: d("2024-05-05"), opening: null, overrides: [], adjustments: [{ effectiveAt: d("2026-12-15"), amount: 2, reason: "w", createdById: "hr" }] },
]

// 時間點：每月 1 號與月底，2019 ~ 今天
const asOfs: Date[] = []
for (let y = 2019; y <= 2026; y++) {
  for (let m = 0; m < 12; m++) {
    const first = new Date(Date.UTC(y, m, 1))
    const last = new Date(Date.UTC(y, m + 1, 0))
    if (first <= NOW) asOfs.push(first)
    if (last <= NOW) asOfs.push(last)
  }
}

describe("buildBackfillRows 與舊公式等價（asOf <= 遷移日）", () => {
  for (const c of cases) {
    it(c.name, () => {
      const rows = buildBackfillRows({ ...c, defaultDays: 10, now: NOW })
      for (const asOf of asOfs) {
        const legacy = legacyCalcCalendarYearCumulative(
          c.hireDate, asOf, 10, c.overrides,
          c.adjustments.map((a) => ({ effectiveAt: a.effectiveAt, amount: a.amount })),
          c.opening ?? undefined,
        )
        expect(sumGrantTotal(rows, asOf), `${c.name} @ ${asOf.toISOString().slice(0, 10)}`).toBe(legacy)
      }
    })
  }

  it("有期初者不產生 PRORATA；無期初者 PRORATA 用舊天數算法原值", () => {
    const withOpening = buildBackfillRows({ ...cases[5], defaultDays: 10, now: NOW })
    expect(withOpening.some((r) => r.kind === "PRORATA")).toBe(false)
    const sophia = buildBackfillRows({ ...cases[0], defaultDays: 10, now: NOW })
    expect(sophia.find((r) => r.kind === "PRORATA")).toMatchObject({ amount: 4, periodKey: "PRORATA:2026", year: 2026 })
  })

  it("沒有到職日 → 空陣列", () => {
    expect(buildBackfillRows({ hireDate: null, opening: null, overrides: [], adjustments: [], defaultDays: 10, now: NOW })).toEqual([])
  })
})
