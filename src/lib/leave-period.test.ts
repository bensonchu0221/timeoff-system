import { describe, it, expect } from "vitest"
import { normalizeParts, dayPartOn, leavesConflict, formatLeavePeriod, partsLabel } from "./leave-period"

const d = (s: string) => new Date(`${s}T00:00:00Z`)
const fmt = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`
const leave = (s: string, e: string, partOfDay = "ALL_DAY", endPartOfDay = "ALL_DAY") =>
  ({ startDate: d(s), endDate: d(e), partOfDay, endPartOfDay })

describe("normalizeParts", () => {
  it("單日：endPartOfDay 跟 partOfDay 一致", () =>
    expect(normalizeParts(d("2026-10-20"), d("2026-10-20"), "MORNING", "ALL_DAY")).toEqual({ partOfDay: "MORNING", endPartOfDay: "MORNING" }))
  it("多天：下午開始 + 上午結束", () =>
    expect(normalizeParts(d("2026-10-20"), d("2026-10-22"), "AFTERNOON", "MORNING")).toEqual({ partOfDay: "AFTERNOON", endPartOfDay: "MORNING" }))
  it("多天：沒帶 endPartOfDay → 全天", () =>
    expect(normalizeParts(d("2026-10-20"), d("2026-10-22"), "ALL_DAY", undefined)).toEqual({ partOfDay: "ALL_DAY", endPartOfDay: "ALL_DAY" }))
  it("多天：開始那天上半天 / 結束那天下半天 → 拒絕", () => {
    expect(() => normalizeParts(d("2026-10-20"), d("2026-10-22"), "MORNING", "ALL_DAY")).toThrow("開始那天")
    expect(() => normalizeParts(d("2026-10-20"), d("2026-10-22"), "ALL_DAY", "AFTERNOON")).toThrow("結束那天")
  })
})

describe("dayPartOn", () => {
  const l = leave("2026-10-20", "2026-10-22", "AFTERNOON", "MORNING")
  it("首日 / 中間 / 末日 / 範圍外", () => {
    expect(dayPartOn(l, d("2026-10-20"))).toBe("AFTERNOON")
    expect(dayPartOn(l, d("2026-10-21"))).toBe("ALL_DAY")
    expect(dayPartOn(l, d("2026-10-22"))).toBe("MORNING")
    expect(dayPartOn(l, d("2026-10-23"))).toBeNull()
  })
  it("單日看 partOfDay", () => expect(dayPartOn(leave("2026-10-20", "2026-10-20", "MORNING", "MORNING"), d("2026-10-20"))).toBe("MORNING"))
})

describe("leavesConflict", () => {
  it("多天上午結束 + 末日下午的單日假 → 可並存", () =>
    expect(leavesConflict(leave("2026-10-20", "2026-10-22", "ALL_DAY", "MORNING"), leave("2026-10-22", "2026-10-22", "AFTERNOON", "AFTERNOON"))).toBe(false))
  it("多天下午開始 + 首日上午的單日假 → 可並存", () =>
    expect(leavesConflict(leave("2026-10-20", "2026-10-22", "AFTERNOON"), leave("2026-10-20", "2026-10-20", "MORNING", "MORNING"))).toBe(false))
  it("上午結束 + 下午開始接在同一天 → 可並存", () =>
    expect(leavesConflict(leave("2026-10-19", "2026-10-20", "ALL_DAY", "MORNING"), leave("2026-10-20", "2026-10-22", "AFTERNOON"))).toBe(false))
  it("重疊到中間的全天 → 衝突", () =>
    expect(leavesConflict(leave("2026-10-20", "2026-10-22", "ALL_DAY", "MORNING"), leave("2026-10-21", "2026-10-21", "AFTERNOON", "AFTERNOON"))).toBe(true))
  it("末日上午結束 + 同一天上半天 → 衝突", () =>
    expect(leavesConflict(leave("2026-10-20", "2026-10-22", "ALL_DAY", "MORNING"), leave("2026-10-22", "2026-10-22", "MORNING", "MORNING"))).toBe(true))
  it("沒重疊 → 不衝突", () =>
    expect(leavesConflict(leave("2026-10-20", "2026-10-21"), leave("2026-10-22", "2026-10-23"))).toBe(false))
})

describe("formatLeavePeriod / partsLabel", () => {
  it("單日", () => {
    expect(formatLeavePeriod(d("2026-06-03"), d("2026-06-03"), { partOfDay: "AFTERNOON" }, fmt)).toBe("6/3 (下半天)")
    expect(formatLeavePeriod(d("2026-06-03"), d("2026-06-03"), { partOfDay: "ALL_DAY" }, fmt)).toBe("6/3")
  })
  it("多天含半天頭尾", () => {
    expect(formatLeavePeriod(d("2026-10-20"), d("2026-10-22"), { partOfDay: "AFTERNOON", endPartOfDay: "MORNING" }, fmt)).toBe("10/20 下午–10/22 上午")
    expect(formatLeavePeriod(d("2026-10-20"), d("2026-10-22"), { partOfDay: "ALL_DAY", endPartOfDay: "MORNING" }, fmt)).toBe("10/20–10/22 上午")
    expect(formatLeavePeriod(d("2026-10-20"), d("2026-10-22"), { partOfDay: "ALL_DAY", endPartOfDay: "ALL_DAY" }, fmt)).toBe("10/20–10/22")
  })
  it("partsLabel", () => {
    expect(partsLabel(d("2026-10-20"), d("2026-10-20"), { partOfDay: "MORNING" })).toBe("上半天")
    expect(partsLabel(d("2026-10-20"), d("2026-10-22"), { partOfDay: "ALL_DAY", endPartOfDay: "ALL_DAY" })).toBe("全天")
    expect(partsLabel(d("2026-10-20"), d("2026-10-22"), { partOfDay: "AFTERNOON", endPartOfDay: "MORNING" })).toBe("首日下午開始、末日上午結束")
  })
})
