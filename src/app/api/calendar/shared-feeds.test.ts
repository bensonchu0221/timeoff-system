import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  leaveRequest: { findMany: vi.fn() },
}))
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }))

import { GET as companyGET } from "./company/[userId]/route"
import { GET as teamGET } from "./team/[managerId]/route"
import { GET as personalGET } from "./[userId]/route"

const leave = {
  id: "l1", userId: "u1", startDate: new Date("2026-11-02T00:00:00Z"), endDate: new Date("2026-11-02T00:00:00Z"),
  partOfDay: "ALL_DAY", reason: "看婦產科回診", leaveType: { name: "病假" },
}
const req = (path: string) => new NextRequest(`http://x${path}?token=t`)

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", name: "U1", managerId: null, calendarToken: "t" })
  mockPrisma.user.findMany.mockResolvedValue([{ id: "u1", name: "U1" }])
  mockPrisma.leaveRequest.findMany.mockResolvedValue([leave])
})

describe("共享行事曆不帶請假原因", () => {
  it("全公司行事曆：只有「誰 - 假別」，沒有原因", async () => {
    const ics = await (await companyGET(req("/api/calendar/company/u1.ics"), { params: Promise.resolve({ userId: "u1.ics" }) })).text()
    expect(ics).toContain("U1 - 病假")
    expect(ics).not.toContain("DESCRIPTION")
    expect(ics).not.toContain("婦產科")
  })

  it("團隊行事曆：同上", async () => {
    const ics = await (await teamGET(req("/api/calendar/team/u1.ics"), { params: Promise.resolve({ managerId: "u1.ics" }) })).text()
    expect(ics).toContain("U1 - 病假")
    expect(ics).not.toContain("婦產科")
  })

  it("個人行事曆：保留自己的原因", async () => {
    const ics = await (await personalGET(req("/api/calendar/u1.ics"), { params: Promise.resolve({ userId: "u1.ics" }) })).text()
    expect(ics).toContain("婦產科")
  })
})
