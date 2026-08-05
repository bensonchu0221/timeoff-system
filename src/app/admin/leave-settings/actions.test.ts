import { describe, it, expect, vi, beforeEach } from "vitest"

// ── mocks ──（vi.mock 會被 hoist，所以 mock 物件要用 vi.hoisted 建立）
const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  leaveType: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }))
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "admin@example.com" } })) }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock("@/lib/impersonation", () => ({ assertNotImpersonating: vi.fn(async () => {}) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { createLeaveType } from "./actions"

const fd = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.append(k, v)
  return f
}

describe("createLeaveType", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.findUnique.mockResolvedValue({ id: "admin-id", role: "ADMIN" })
  })

  it("同名假別已被軟刪除 → 復活該筆並套用新設定，不再丟 P2002", async () => {
    // 使用者先前刪掉的「補假」：isActive=false、天數設錯為 0
    mockPrisma.leaveType.findUnique.mockResolvedValue({
      id: "old-id",
      name: "補假",
      isActive: false,
      defaultDays: 0,
    })
    mockPrisma.leaveType.update.mockResolvedValue({ id: "old-id", name: "補假" })

    const result = await createLeaveType(
      fd({ name: "補假", defaultDays: "5", isPaid: "false", requireProof: "true" })
    )

    // 不應該再走 create（那會撞 name @unique）
    expect(mockPrisma.leaveType.create).not.toHaveBeenCalled()
    expect(mockPrisma.leaveType.update).toHaveBeenCalledWith({
      where: { id: "old-id" },
      data: { defaultDays: 5, isPaid: false, requireProof: true, isActive: true },
    })
    expect(result).toMatchObject({ success: true })
  })

  it("同名假別仍啟用中 → 回傳 success:false 明確訊息（不 throw，production 才看得到）", async () => {
    mockPrisma.leaveType.findUnique.mockResolvedValue({
      id: "live-id",
      name: "特休",
      isActive: true,
      defaultDays: 10,
    })

    const result = await createLeaveType(
      fd({ name: "特休", defaultDays: "10", isPaid: "true", requireProof: "false" })
    )

    expect(mockPrisma.leaveType.create).not.toHaveBeenCalled()
    expect(mockPrisma.leaveType.update).not.toHaveBeenCalled()
    expect(result).toMatchObject({ success: false })
    expect(result.message).toContain("已存在")
  })

  it("全新名稱 → 正常建立", async () => {
    mockPrisma.leaveType.findUnique.mockResolvedValue(null)
    mockPrisma.leaveType.create.mockResolvedValue({ id: "new-id", name: "生日假" })

    const result = await createLeaveType(
      fd({ name: "生日假", defaultDays: "1", isPaid: "true", requireProof: "false" })
    )

    expect(mockPrisma.leaveType.create).toHaveBeenCalledWith({
      data: { name: "生日假", defaultDays: 1, isPaid: true, requireProof: false, isActive: true },
    })
    expect(result).toMatchObject({ success: true })
  })
})
