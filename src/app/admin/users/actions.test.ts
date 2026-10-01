import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(async () => []) },
  annualLeaveGrant: { updateMany: vi.fn() },
}))
const svc = vi.hoisted(() => ({
  grantOnHire: vi.fn(async () => ({ created: [] })),
  previewHireDateRecalc: vi.fn(async () => []),
  voidGrantsAfterTermination: vi.fn(async () => []),
  setOpening: vi.fn(),
}))
vi.mock("@/lib/annual-grant", () => svc)
const mockAuth = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }))
vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock("@/lib/impersonation", () => ({ assertNotImpersonating: vi.fn(async () => {}) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateUserRole, updateUserHireDate, updateUserTerminatedDate, clearAnnualLeaveOpening } from "./actions"

describe("admin/users actions 權限", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "u1", email: "emp@example.com" } })
  })

  it("一般員工呼叫 updateUserRole → Forbidden，且不寫 DB", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", role: "EMPLOYEE" })
    await expect(updateUserRole("u1", "ADMIN")).rejects.toThrow("Forbidden")
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it("主管呼叫 updateUserHireDate → Forbidden", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u1", role: "MANAGER" })
    await expect(updateUserHireDate("u2", "2026-01-01")).rejects.toThrow("Forbidden")
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it("未登入 → Unauthorized", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(updateUserRole("u1", "ADMIN")).rejects.toThrow("Unauthorized")
  })

  it("ADMIN 可以呼叫", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "u1", role: "ADMIN" }) // requireAdmin
      .mockResolvedValueOnce({ role: "EMPLOYEE" })        // before
    mockPrisma.user.update.mockResolvedValue({})
    await expect(updateUserRole("u2", "MANAGER")).resolves.toMatchObject({ success: true })
  })
})

describe("到職日 / 離職串接 grant", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "hr", email: "hr@example.com" } })
    mockPrisma.user.update.mockResolvedValue({})
  })

  it("原本沒有到職日 → grantOnHire", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "hr", role: "ADMIN" })
      .mockResolvedValueOnce({ hireDate: null })
    await updateUserHireDate("u", "2026-10-01")
    expect(svc.grantOnHire).toHaveBeenCalledWith("u", { actorId: "hr" })
    expect(svc.previewHireDateRecalc).not.toHaveBeenCalled()
  })

  it("原本有到職日 → 回傳重算預覽，不自動寫入", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "hr", role: "ADMIN" })
      .mockResolvedValueOnce({ hireDate: new Date("2026-08-24T00:00:00Z") })
    svc.previewHireDateRecalc.mockResolvedValueOnce([{ periodKey: "PRORATA:2026", oldAmount: 3, newAmount: 4 }] as never)
    const r = await updateUserHireDate("u", "2026-08-01")
    expect(r.recalc).toHaveLength(1)
    expect(svc.grantOnHire).not.toHaveBeenCalled()
  })

  it("標記離職 → 作廢離職日之後的發放，訊息列出明細", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "hr", role: "ADMIN" })
    svc.voidGrantsAfterTermination.mockResolvedValueOnce([{ id: "g", kind: "ANNUAL", year: 2027, amount: 10 }] as never)
    const r = await updateUserTerminatedDate("u", "2026-12-20")
    expect(svc.voidGrantsAfterTermination).toHaveBeenCalledWith("u", new Date("2026-12-20"), "hr")
    expect(r.message).toBe("已標記離職；已作廢 2027 年度特休 10 天")
  })
})

describe("到職日格式防呆", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "hr", email: "hr@example.com" } })
    mockPrisma.user.findUnique.mockResolvedValue({ id: "hr", role: "ADMIN" })
  })

  it.each(["0002-01-15", "1979-12-31", "2099-01-01", "2026-13-01", "abc"])("不合理的到職日 %s → 拒絕，不寫 DB、不發放", async (bad) => {
    await expect(updateUserHireDate("u", bad)).rejects.toThrow("到職日不合理")
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    expect(svc.grantOnHire).not.toHaveBeenCalled()
  })
})

describe("清除期初", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ user: { id: "hr", email: "hr@example.com" } })
  })

  it("作廢 OPENING 紀錄、清舊欄位，並回傳重算預覽", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: "hr", role: "ADMIN" })
      .mockResolvedValueOnce({ annualLeaveOpeningBalance: 12, annualLeaveOpeningAt: new Date("2026-01-01T00:00:00Z"), annualLeaveOpeningB: null, annualLeaveOpeningR: null })
    mockPrisma.user.update.mockResolvedValue({})
    svc.previewHireDateRecalc.mockResolvedValueOnce([{ periodKey: "PRORATA:2023" }] as never)
    const r = await clearAnnualLeaveOpening("u")
    expect(mockPrisma.annualLeaveGrant.updateMany).toHaveBeenCalled()
    expect(mockPrisma.user.update.mock.calls[0][0].data).toMatchObject({ annualLeaveOpeningBalance: null })
    expect(r.recalc).toHaveLength(1)
  })
})
