import { describe, it, expect, vi, beforeEach } from "vitest"

// ── mocks ──（vi.mock 會被 hoist，所以 mock 物件要用 vi.hoisted 建立）
const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  leaveType: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    aggregate: vi.fn(async () => ({ _max: { sortOrder: 6 } })),
  },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}))

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }))
vi.mock("@/auth", () => ({ auth: vi.fn(async () => ({ user: { email: "admin@example.com" } })) }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock("@/lib/impersonation", () => ({ assertNotImpersonating: vi.fn(async () => {}) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { createLeaveType, reorderLeaveTypes } from "./actions"

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
      data: { defaultDays: 5, isPaid: false, requireProof: true, isActive: true, sortOrder: 7 },
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
      data: { name: "生日假", defaultDays: 1, isPaid: true, requireProof: false, isActive: true, sortOrder: 7 },
    })
    expect(result).toMatchObject({ success: true })
  })
})

describe("reorderLeaveTypes（假別拖拉排序）", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.findUnique.mockResolvedValue({ id: "admin-id", role: "ADMIN" })
    mockPrisma.leaveType.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }])
    mockPrisma.leaveType.update.mockImplementation(async (args: unknown) => args)
  })

  it("依傳入順序寫入 sortOrder = 0, 1, 2（同一個 transaction）", async () => {
    const r = await reorderLeaveTypes(["c", "a", "b"])
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
    expect(mockPrisma.leaveType.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: "c" }, data: { sortOrder: 0 } },
      { where: { id: "a" }, data: { sortOrder: 1 } },
      { where: { id: "b" }, data: { sortOrder: 2 } },
    ])
    expect(r).toMatchObject({ success: true })
  })

  it("清單跟目前啟用中的假別對不上（少了或多了）→ 拒絕，不寫入", async () => {
    await expect(reorderLeaveTypes(["c", "a"])).rejects.toThrow("假別清單已變動")
    await expect(reorderLeaveTypes(["c", "a", "b", "x"])).rejects.toThrow("假別清單已變動")
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()
  })

  it("非管理員 → Forbidden", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u", role: "EMPLOYEE" })
    await expect(reorderLeaveTypes(["a", "b", "c"])).rejects.toThrow("Forbidden")
  })
})
