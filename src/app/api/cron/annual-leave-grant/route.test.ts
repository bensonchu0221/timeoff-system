import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockGrant = vi.hoisted(() => vi.fn())
const mockNotice = vi.hoisted(() => vi.fn(async (_text: string) => 2))
vi.mock("@/lib/annual-grant", () => ({ grantAnnualForYear: mockGrant }))
vi.mock("@/lib/line", () => ({ sendLineAdminNotice: mockNotice }))
vi.mock("@/lib/date-format", () => ({ todayStartUTCFromTaipei: () => new Date("2026-12-01T00:00:00Z") }))
vi.mock("@/lib/db", () => ({ prisma: {} }))

import { GET } from "./route"

const req = (secret?: string) =>
  new NextRequest("http://x/api/cron/annual-leave-grant", { headers: secret ? { "x-cron-secret": secret } : {} })

describe("GET /api/cron/annual-leave-grant", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.CRON_SECRET = "s" })

  it("沒帶或帶錯 secret → 401，不發放", async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req("bad"))).status).toBe(401)
    expect(mockGrant).not.toHaveBeenCalled()
  })

  it("12/1 發明年；成功通知管理員", async () => {
    mockGrant.mockResolvedValue({ year: 2027, granted: [{ userId: "a" }], skipped: [{ userId: "b" }], ineligible: [] })
    const res = await GET(req("s"))
    expect(res.status).toBe(200)
    expect(mockGrant).toHaveBeenCalledWith(2027, { source: "SYSTEM_CRON", actorId: null })
    expect(mockNotice.mock.calls[0][0]).toContain("2027 年度特休發放完成：發放 1 人、略過 1 人")
  })

  it("失敗 → 500 並通知管理員", async () => {
    mockGrant.mockRejectedValue(new Error("db down"))
    const res = await GET(req("s"))
    expect(res.status).toBe(500)
    expect(mockNotice.mock.calls[0][0]).toContain("2027 年度特休發放失敗：db down")
  })
})
