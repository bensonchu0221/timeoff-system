import { describe, it, expect, vi, beforeEach } from "vitest"

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(async () => [{ id: "emp" }]),
  leaveRequest: { updateMany: vi.fn(async () => ({ count: 1 })) },
}))
const mockPrisma = vi.hoisted(() => ({
  leaveRequest: { findUnique: vi.fn(), findMany: vi.fn(async () => []), update: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  leaveType: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))
const mockBalance = vi.hoisted(() => vi.fn())
const mockAudit = vi.hoisted(() => vi.fn(async (_p: { payload?: Record<string, unknown> }) => {}))
const mockAuth = vi.hoisted(() => vi.fn(async () => ({ user: { id: "emp" } })))

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }))
vi.mock("@/auth", () => ({ auth: mockAuth }))
vi.mock("@/lib/audit", () => ({ logAudit: mockAudit }))
vi.mock("@/lib/impersonation", () => ({ assertNotImpersonating: vi.fn(async () => {}) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/gcs", () => ({ deleteObjects: vi.fn() }))
vi.mock("@/lib/approval", () => ({ getFinalApprover: vi.fn(async () => null) }))
vi.mock("@/lib/email", () => ({
  shouldSendEmail: () => false, displayName: (n: string) => n,
  sendLeaveApplicationEmail: vi.fn(), sendLeaveResultEmail: vi.fn(), sendDepartmentLeaveEmail: vi.fn(), sendLeaveCancelledEmail: vi.fn(),
  sendBackupAssignedEmail: vi.fn(), sendBackupRemovedEmail: vi.fn(), sendBossReviewEmail: vi.fn(), sendFirstApprovedEmail: vi.fn(),
}))
vi.mock("@/lib/line", () => ({
  shouldSendLine: () => false,
  sendLineLeaveApplication: vi.fn(), sendLineLeaveResult: vi.fn(), sendLineSameDepartment: vi.fn(), sendLineLeaveCancelled: vi.fn(),
  sendLineBackupAssigned: vi.fn(), sendLineBackupRemoved: vi.fn(), sendLineBossReview: vi.fn(), sendLineFirstApproved: vi.fn(),
}))
vi.mock("@/lib/date-format", () => ({ todayStartUTCFromTaipei: () => new Date("2026-10-01T00:00:00Z") }))
vi.mock("@/lib/leave-utils", () => ({
  getUserLeaveBalance: mockBalance,
  calculateDurationDays: vi.fn(async () => 1),
  monthsBetween: (a: Date, b: Date) => (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0),
  partsOfDayConflict: () => false,
  findAnnualShortfall: vi.fn(async () => null),
}))

import { reviewLeaveAsUser, updateLeave } from "./leave"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const pending = (over: Record<string, unknown> = {}) => ({
  id: "r1", userId: "emp", leaveTypeId: "lt", status: "PENDING", startDate: d("2026-11-02"), endDate: d("2026-11-02"),
  partOfDay: "ALL_DAY", durationDays: 1, approverId: "mgr", secondApproverId: null, firstApprovedAt: null, backupId: null,
  user: { id: "emp", name: "Emp", departmentId: null }, leaveType: { name: "特休" }, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.$transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx))
  mockBalance.mockResolvedValue({ total: 10, used: 0, pending: 1, pendingFirst: 1, pendingSecond: 0, remaining: 9 })
})

describe("reviewLeaveAsUser：核准的額度檢查在 transaction 內", () => {
  it("先鎖住申請人（SELECT … FOR UPDATE），再用 transaction 連線查額度", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(pending())
    mockPrisma.user.findUnique.mockResolvedValue({ id: "mgr", role: "MANAGER", terminatedDate: null })
    await reviewLeaveAsUser("mgr", "r1", "APPROVED")
    const sql = (tx.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join("?")
    expect(sql).toMatch(/FOR UPDATE/)
    expect(mockBalance).toHaveBeenCalledWith("emp", "lt", d("2026-11-02"), tx)
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mockBalance.mock.invocationCallOrder[0])
  })
})

describe("自己核准：稽核紀錄要標記", () => {
  it("ADMIN 核准自己的假單 → payload.selfApproved = true", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(pending({ userId: "boss-admin", approverId: "mgr", user: { id: "boss-admin", name: "A", departmentId: null } }))
    mockPrisma.user.findUnique.mockResolvedValue({ id: "boss-admin", role: "ADMIN", terminatedDate: null })
    await reviewLeaveAsUser("boss-admin", "r1", "APPROVED")
    expect(mockAudit.mock.calls[0][0]).toMatchObject({ payload: expect.objectContaining({ selfApproved: true }) })
  })

  it("主管核准部屬的假單 → 不標記", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(pending())
    mockPrisma.user.findUnique.mockResolvedValue({ id: "mgr", role: "MANAGER", terminatedDate: null })
    await reviewLeaveAsUser("mgr", "r1", "APPROVED")
    expect(mockAudit.mock.calls[0][0].payload).not.toHaveProperty("selfApproved")
  })
})

describe("updateLeave：改假別時套用與申請時相同的限制", () => {
  const base = { startDate: "2026-11-02", endDate: "2026-11-02", partOfDay: "ALL_DAY" as const }

  it("男性改成生理假 → 擋下", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(pending({ leaveTypeId: "lt-annual", user: { id: "emp", name: "Emp", gender: "MALE", hireDate: d("2020-01-01") } }))
    mockPrisma.leaveType.findUnique.mockResolvedValue({ id: "lt-mens", name: "生理假" })
    const r = await updateLeave("r1", { ...base, leaveTypeId: "lt-mens" })
    expect(r).toEqual({ error: "男性員工無法申請生理假。" })
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled()
  })

  it("到職未滿 3 個月改成特休 → 擋下", async () => {
    mockPrisma.leaveRequest.findUnique.mockResolvedValue(pending({ leaveTypeId: "lt-sick", leaveType: { name: "病假" }, user: { id: "emp", name: "Emp", gender: "FEMALE", hireDate: d("2026-09-01") } }))
    mockPrisma.leaveType.findUnique.mockResolvedValue({ id: "lt-annual", name: "特休" })
    const r = await updateLeave("r1", { ...base, leaveTypeId: "lt-annual" })
    expect(r).toEqual({ error: "特休需到職滿 3 個月後才能申請。" })
    expect(mockPrisma.leaveRequest.update).not.toHaveBeenCalled()
  })
})
