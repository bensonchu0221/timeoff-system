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
const mockOffboard = vi.hoisted(() => vi.fn(async () => []))
vi.mock("@/lib/offboarding", () => ({ offboardTerminatedUsers: mockOffboard }))

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

  // 以台北今天為基準的相對日期，測試不會因日子過去而失效
  const dayStr = (offset: number) => {
    const t = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }))
    return new Date(t.getTime() + offset * 86400e3).toISOString().slice(0, 10)
  }

  it("填未來的最後上班日 → 作廢之後的發放、不立即收尾，訊息說明隔天生效", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "hr", role: "ADMIN" })
    svc.voidGrantsAfterTermination.mockResolvedValueOnce([{ id: "g", kind: "ANNUAL", year: 2027, amount: 10 }] as never)
    const r = await updateUserTerminatedDate("u", dayStr(10))
    expect(svc.voidGrantsAfterTermination).toHaveBeenCalledWith("u", new Date(dayStr(10)), "hr")
    expect(mockOffboard).not.toHaveBeenCalled()
    expect(r.message).toBe(`已設定最後上班日 ${dayStr(10)}，隔天起自動生效；已作廢 2027 年度特休 10 天`)
  })

  it("最後上班日 = 今天 → 當天仍在職，不立即收尾", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "hr", role: "ADMIN" })
    await updateUserTerminatedDate("u", dayStr(0))
    expect(mockOffboard).not.toHaveBeenCalled()
  })

  it("補登過去日期 → 立即生效並收尾（解除 LINE、登出）", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: "hr", role: "ADMIN" })
    const r = await updateUserTerminatedDate("u", dayStr(-3))
    expect(mockOffboard).toHaveBeenCalledWith({ userIds: ["u"] })
    expect(r.message).toBe("已標記離職並立即生效（已解除 LINE 綁定、登出）")
  })

  it("過去日期 + 還有在職下屬 → 擋下；未來日期 + 有下屬 → 放行但提醒改派", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "hr", role: "ADMIN" })
    mockPrisma.user.findMany.mockResolvedValue([{ id: "s", name: "Sub", email: "s@x" }] as never)
    await expect(updateUserTerminatedDate("u", dayStr(-1))).rejects.toThrow("請先將下屬的直屬主管改派")
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
    const r = await updateUserTerminatedDate("u", dayStr(5))
    expect(r.message).toContain("請在生效前把 Sub 的直屬主管改派給其他人")
    mockPrisma.user.findMany.mockResolvedValue([])
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
