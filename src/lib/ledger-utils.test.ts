import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  leaveType: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  annualLeaveGrant: { findMany: vi.fn() },
  leaveRequest: { findMany: vi.fn() },
}))
vi.mock("./db", () => ({ prisma: mockPrisma }))

import { getLeaveLedger } from "./ledger-utils"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe("getLeaveLedger 特休（讀 grants）", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.leaveType.findUnique.mockResolvedValue({ id: "lt", name: "特休", defaultDays: 10 })
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u", hireDate: d("2026-10-01") })
    mockPrisma.leaveRequest.findMany.mockResolvedValue([
      { id: "r1", startDate: d("2026-11-02"), endDate: d("2026-11-02"), durationDays: 1, status: "PENDING" },
    ])
  })

  it("發放說明用 basis.text；未生效的不顯示；running balance 正確", async () => {
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([
      { id: "g1", kind: "PRORATA", effectiveAt: d("2026-10-01"), amount: 2.5, basis: { text: "到職首年：剩 3 個月 × 10 ÷ 12 → 2.5 天" } },
      { id: "g2", kind: "ANNUAL", effectiveAt: d("2099-01-01"), amount: 10, basis: { text: "未來" } },
    ])
    const events = await getLeaveLedger("u", "lt")
    expect(events.map((e) => e.description)).toEqual([
      "請假 (2026-11-02~2026-11-02) [待審核]",
      "到職首年：剩 3 個月 × 10 ÷ 12 → 2.5 天",
    ])
    expect(events[0].runningBalance).toBe(1.5)
  })

  it("負數調整列為 USAGE", async () => {
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([
      { id: "g3", kind: "ADJUSTMENT", effectiveAt: d("2026-09-30"), amount: -1, basis: { text: "HR 調整 -1 天（扣除）" } },
    ])
    const events = await getLeaveLedger("u", "lt")
    expect(events.find((e) => e.id === "grant-g3")?.type).toBe("USAGE")
  })
})
