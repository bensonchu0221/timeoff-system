import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockSync = vi.hoisted(() => vi.fn())
const mockNotice = vi.hoisted(() => vi.fn(async (_text: string) => 2))
vi.mock("@/lib/holiday-sync", () => ({ syncHolidaysForYear: mockSync }))
vi.mock("@/lib/line", () => ({ sendLineAdminNotice: mockNotice }))
vi.mock("@/lib/date-format", () => ({ todayStartUTCFromTaipei: () => new Date("2026-09-01T00:00:00Z") }))
vi.mock("@/lib/db", () => ({ prisma: {} }))

import { GET } from "./route"

const req = (secret?: string) =>
  new NextRequest("http://x/api/cron/sync-holidays", { headers: secret ? { "x-cron-secret": secret } : {} })

describe("GET /api/cron/sync-holidays", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = "s" })

  it("沒帶或帶錯 secret → 401", async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req("bad"))).status).toBe(401)
    expect(mockSync).not.toHaveBeenCalled()
  })

  it("同步明年與今年；明年未公布不算失敗；通知管理員", async () => {
    mockSync.mockImplementation(async (year: number) =>
      year === 2027 ? { year, status: "not_published", upserted: 0, removed: 0 } : { year, status: "synced", upserted: 120, removed: 0 })
    const res = await GET(req("s"))
    expect(res.status).toBe(200)
    expect(mockSync.mock.calls.map((c) => c[0])).toEqual([2027, 2026])
    expect(mockNotice.mock.calls[0][0]).toContain("2027 年：尚未公布")
    expect(mockNotice.mock.calls[0][0]).toContain("2026 年：同步 120 筆")
  })

  it("任一年失敗 → 500 並通知管理員", async () => {
    mockSync.mockRejectedValue(new Error("HTTP 500"))
    const res = await GET(req("s"))
    expect(res.status).toBe(500)
    expect(mockNotice.mock.calls[0][0]).toContain("國定假日同步失敗")
  })
})
