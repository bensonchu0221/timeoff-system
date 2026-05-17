import { describe, it, expect } from "vitest"
import {
  formatTaipeiDate,
  formatTaipeiDateISO,
  startOfYearUTC,
  todayStartUTCFromTaipei,
} from "./date-format"

describe("startOfYearUTC", () => {
  it("回傳該年 1/1 的 UTC midnight", () => {
    const d = startOfYearUTC(2026)
    expect(d.toISOString()).toBe("2026-01-01T00:00:00.000Z")
  })

  it("對閏年仍正確", () => {
    expect(startOfYearUTC(2024).toISOString()).toBe("2024-01-01T00:00:00.000Z")
  })
})

describe("formatTaipeiDateISO", () => {
  it("UTC 00:00 在台北是同日 08:00 → 維持當日", () => {
    // UTC 2026-05-17 00:00 = Taipei 2026-05-17 08:00
    expect(formatTaipeiDateISO(new Date("2026-05-17T00:00:00Z"))).toBe("2026-05-17")
  })

  it("UTC 前一天的 23:00 → 換算為台北已經是隔天", () => {
    // UTC 2026-05-16 23:00 = Taipei 2026-05-17 07:00
    expect(formatTaipeiDateISO(new Date("2026-05-16T23:00:00Z"))).toBe("2026-05-17")
  })

  it("UTC 當天 17:00 → 台北為當天 01:00 隔天，仍是隔日", () => {
    // UTC 2026-05-17 17:00 = Taipei 2026-05-18 01:00
    expect(formatTaipeiDateISO(new Date("2026-05-17T17:00:00Z"))).toBe("2026-05-18")
  })

  it("接受字串", () => {
    expect(formatTaipeiDateISO("2026-05-17T00:00:00Z")).toBe("2026-05-17")
  })
})

describe("formatTaipeiDate", () => {
  it("回傳 zh-TW 在地化格式（不檢精準字串，只檢含當天年月日）", () => {
    const out = formatTaipeiDate(new Date("2026-05-17T00:00:00Z"))
    expect(out).toMatch(/2026/)
    expect(out).toMatch(/5/)
    expect(out).toMatch(/17/)
  })
})

describe("todayStartUTCFromTaipei", () => {
  it("回傳值的小時/分/秒/毫秒都是 0（UTC midnight）", () => {
    const d = todayStartUTCFromTaipei()
    expect(d.getUTCHours()).toBe(0)
    expect(d.getUTCMinutes()).toBe(0)
    expect(d.getUTCSeconds()).toBe(0)
    expect(d.getUTCMilliseconds()).toBe(0)
  })

  it("回傳的日期等於台北「今天」的日期", () => {
    const d = todayStartUTCFromTaipei()
    const taipeiToday = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" })
    expect(d.toISOString().slice(0, 10)).toBe(taipeiToday)
  })
})
