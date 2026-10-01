import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  holiday: { upsert: vi.fn(), deleteMany: vi.fn(async () => ({ count: 0 })) },
}))
vi.mock("./db", () => ({ prisma: mockPrisma }))

import { planHolidayRows, syncHolidaysForYear } from "./holiday-sync"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

// 產生一整年的假資料（週末 isHoliday=true），再覆蓋指定日期
function fullYear(year: number, overrides: Record<string, { isHoliday: boolean; description: string }> = {}) {
  const days = []
  for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 86_400_000) {
    const dt = new Date(t)
    const key = dt.toISOString().slice(0, 10).replace(/-/g, "")
    const weekend = dt.getUTCDay() === 0 || dt.getUTCDay() === 6
    days.push(overrides[key] ? { date: key, ...overrides[key] } : { date: key, isHoliday: weekend, description: "" })
  }
  return days
}

const okFetch = (body: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch

describe("planHolidayRows", () => {
  it("平日國定假日 → isWorkDay=false；週末補班 → isWorkDay=true；一般平日不寫", () => {
    const rows = planHolidayRows([
      { date: "20270101", isHoliday: true, description: "開國紀念日" },   // 週五
      { date: "20270102", isHoliday: true, description: "" },             // 週六
      { date: "20270104", isHoliday: false, description: "" },            // 週一一般日
      { date: "20270109", isHoliday: false, description: "補行上班" },     // 週六補班
    ])
    expect(rows).toEqual([
      { date: d("2027-01-01"), name: "開國紀念日", isWorkDay: false },
      { date: d("2027-01-02"), name: "國定假日", isWorkDay: false },
      { date: d("2027-01-09"), name: "補行上班", isWorkDay: true },
    ])
  })

  it("判斷週末用 UTC（伺服器時區不影響）", () => {
    // 2027-01-03 是週日；若誤用本地時區可能被判成週六/週一
    expect(planHolidayRows([{ date: "20270103", isHoliday: false, description: "" }])).toEqual([
      { date: d("2027-01-03"), name: "補班日", isWorkDay: true },
    ])
  })
})

describe("syncHolidaysForYear", () => {
  beforeEach(() => vi.clearAllMocks())

  it("來源 404（尚未公布）→ not_published，不碰 DB", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch
    expect(await syncHolidaysForYear(2028, f)).toEqual({ year: 2028, status: "not_published", upserted: 0, removed: 0 })
    expect(mockPrisma.holiday.upsert).not.toHaveBeenCalled()
  })

  it("其他錯誤（500）→ 丟出", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch
    await expect(syncHolidaysForYear(2027, f)).rejects.toThrow("500")
  })

  it("完整一年 → upsert 每筆，並刪除該年度來源已不存在的日期", async () => {
    const body = fullYear(2027, { "20270101": { isHoliday: true, description: "開國紀念日" } })
    mockPrisma.holiday.deleteMany.mockResolvedValueOnce({ count: 2 })
    const r = await syncHolidaysForYear(2027, okFetch(body))
    expect(r.status).toBe("synced")
    expect(r.upserted).toBe(mockPrisma.holiday.upsert.mock.calls.length)
    expect(r.removed).toBe(2)
    const del = (mockPrisma.holiday.deleteMany.mock.calls[0] as unknown as [{ where: { date: { gte: Date; lt: Date; notIn: Date[] } } }])[0].where
    expect(del.date.gte).toEqual(d("2027-01-01"))
    expect(del.date.lt).toEqual(d("2028-01-01"))
    expect(del.date.notIn).toHaveLength(r.upserted)
  })

  it("資料不足一整年（來源異常）→ 只 upsert、不刪除", async () => {
    const r = await syncHolidaysForYear(2027, okFetch(fullYear(2027).slice(0, 100)))
    expect(r.status).toBe("synced")
    expect(mockPrisma.holiday.deleteMany).not.toHaveBeenCalled()
  })
})
