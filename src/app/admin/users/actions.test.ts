import { describe, it, expect, vi, beforeEach } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
}))
const mockAuth = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }))
vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock("@/lib/impersonation", () => ({ assertNotImpersonating: vi.fn(async () => {}) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { updateUserRole, updateUserHireDate } from "./actions"

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
