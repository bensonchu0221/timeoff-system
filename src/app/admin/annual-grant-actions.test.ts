import { describe, it, expect, vi, beforeEach } from "vitest"

const mockRequireAdmin = vi.hoisted(() => vi.fn(async () => "hr"))
const svc = vi.hoisted(() => ({
  previewAnnualForYear: vi.fn(), grantAnnualForYear: vi.fn(), addAdjustment: vi.fn(),
  voidGrant: vi.fn(), previewHireDateRecalc: vi.fn(), applyHireDateRecalc: vi.fn(),
}))
vi.mock("@/lib/admin-guard", () => ({ requireAdmin: mockRequireAdmin }))
vi.mock("@/lib/annual-grant", () => svc)
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock("@/lib/db", () => ({ prisma: { annualLeaveGrant: { findMany: vi.fn() } } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/date-format", () => ({ todayStartUTCFromTaipei: () => new Date("2026-10-01T00:00:00Z") }))

import { grantAnnualAction, voidAnnualGrantAction, addAnnualAdjustmentAction } from "./annual-grant-actions"

describe("annual-grant-actions", () => {
  beforeEach(() => vi.clearAllMocks())

  it("非 ADMIN → 拒絕，不呼叫服務", async () => {
    mockRequireAdmin.mockRejectedValueOnce(new Error("Forbidden"))
    await expect(grantAnnualAction(2027)).rejects.toThrow("Forbidden")
    expect(svc.grantAnnualForYear).not.toHaveBeenCalled()
  })

  it("只能發今年或明年", async () => {
    await expect(grantAnnualAction(2028)).rejects.toThrow("只能發放 2026 或 2027 年")
  })

  it("發放結果訊息含發放與略過人數，source = HR_BUTTON", async () => {
    svc.grantAnnualForYear.mockResolvedValue({ year: 2027, granted: [{ userId: "a" }], skipped: [{ userId: "b" }], ineligible: [] })
    const r = await grantAnnualAction(2027, ["a", "b"])
    expect(svc.grantAnnualForYear).toHaveBeenCalledWith(2027, { userIds: ["a", "b"], source: "HR_BUTTON", actorId: "hr" })
    expect(r.message).toBe("2027 年度特休：發放 1 人、略過 1 人（已發放）")
  })

  it("作廢原因必填", async () => {
    await expect(voidAnnualGrantAction("g", " ")).rejects.toThrow("作廢原因必填")
  })

  it("調整：日期字串轉 UTC midnight", async () => {
    svc.addAdjustment.mockResolvedValue({ id: "x" })
    await addAnnualAdjustmentAction({ userId: "u", effectiveAt: "2026-10-01", amount: 4, reason: "r" })
    expect(svc.addAdjustment.mock.calls[0][0]).toMatchObject({ effectiveAt: new Date("2026-10-01T00:00:00Z"), amount: 4, actorId: "hr" })
  })
})
