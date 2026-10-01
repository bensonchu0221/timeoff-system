import { describe, it, expect, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"

const mockPrisma = vi.hoisted(() => ({
  leaveType: { findFirst: vi.fn() },
  user: { findMany: vi.fn(), findUnique: vi.fn() },
  userLeaveBalance: { findMany: vi.fn() },
  annualLeaveGrant: {
    findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(),
    create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))
vi.mock("./db", () => ({ prisma: mockPrisma }))

import {
  previewAnnualForYear, grantAnnualForYear, grantOnHire, voidGrantsAfterTermination,
  previewHireDateRecalc, voidGrant, setOpening,
} from "./annual-grant"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const p2002 = () => new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" })

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.leaveType.findFirst.mockResolvedValue({ id: "lt-annual", name: "特休", defaultDays: 10 })
  mockPrisma.userLeaveBalance.findMany.mockResolvedValue([])
  mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([])
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma))
})

describe("previewAnnualForYear", () => {
  it("分成 將發放 / 已發放略過 / 不符資格", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "joy", name: "Joy", hireDate: d("2023-08-14"), terminatedDate: null },
      { id: "amy", name: "Amy", hireDate: d("2022-01-01"), terminatedDate: null },
      { id: "new", name: "New", hireDate: d("2027-03-01"), terminatedDate: null },
    ])
    mockPrisma.annualLeaveGrant.findMany.mockImplementation(async (args: { where: { kind?: string | { in: string[] } } }) => {
      if (args.where.kind === "OPENING") return []
      return [{ userId: "amy", createdAt: d("2026-12-01"), source: "SYSTEM_CRON", createdBy: null }]
    })
    const r = await previewAnnualForYear(2027)
    expect(r.toGrant).toEqual([expect.objectContaining({ userId: "joy", amount: 14 })])
    expect(r.skipped).toEqual([expect.objectContaining({ userId: "amy", source: "SYSTEM_CRON" })])
    expect(r.ineligible).toEqual([expect.objectContaining({ userId: "new" })])
  })

  it("期初已含該年 → ineligible（避免重複）", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "joy", name: "Joy", hireDate: d("2023-08-14"), terminatedDate: null }])
    mockPrisma.annualLeaveGrant.findMany.mockImplementation(async (args: { where: { kind?: string } }) =>
      args.where.kind === "OPENING" ? [{ userId: "joy", effectiveAt: d("2026-01-01") }] : [])
    const r = await previewAnnualForYear(2026)
    expect(r.ineligible).toEqual([{ userId: "joy", name: "Joy", reason: "期初餘額已包含此年度" }])
  })
})

describe("grantAnnualForYear 防呆", () => {
  beforeEach(() => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "a", name: "A", hireDate: d("2020-01-01"), terminatedDate: null },
      { id: "b", name: "B", hireDate: d("2020-01-01"), terminatedDate: null },
    ])
  })

  it("寫入時帶 periodKey；被唯一鍵擋下（P2002）視為略過，不丟錯", async () => {
    mockPrisma.annualLeaveGrant.create
      .mockResolvedValueOnce({ id: "g1" })
      .mockRejectedValueOnce(p2002())
    const r = await grantAnnualForYear(2027, { source: "SYSTEM_CRON" })
    expect(r.granted.map((g) => g.userId)).toEqual(["a"])
    expect(r.skipped.map((s) => s.userId)).toEqual(["b"])
    expect(mockPrisma.annualLeaveGrant.create.mock.calls[0][0].data).toMatchObject({
      userId: "a", kind: "ANNUAL", year: 2027, periodKey: "ANNUAL:2027", effectiveAt: d("2027-01-01"), source: "SYSTEM_CRON",
    })
  })

  it("非 P2002 錯誤要丟出", async () => {
    mockPrisma.annualLeaveGrant.create.mockRejectedValue(new Error("db down"))
    await expect(grantAnnualForYear(2027, { source: "SYSTEM_CRON" })).rejects.toThrow("db down")
  })
})

describe("grantOnHire", () => {
  it("12/1 前建檔：只寫首年（A 算法）", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "aaron", name: "Aaron", hireDate: d("2026-10-01"), terminatedDate: null })
    mockPrisma.user.findMany.mockResolvedValue([])
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null) // 無期初
    mockPrisma.annualLeaveGrant.create.mockResolvedValue({ id: "g" })
    const r = await grantOnHire("aaron", { actorId: "hr", today: d("2026-10-01") })
    expect(r.created).toEqual(["PRORATA:2026"])
    expect(mockPrisma.annualLeaveGrant.create.mock.calls[0][0].data).toMatchObject({ kind: "PRORATA", amount: 2.5, source: "HIRE" })
  })

  it("grantOnHire 在 12/5 建檔會補明年 ANNUAL", async () => {
    const u = { id: "dec", name: "Dec", hireDate: d("2026-12-15"), terminatedDate: null }
    mockPrisma.user.findUnique.mockResolvedValue(u)
    mockPrisma.user.findMany.mockResolvedValue([u])
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null)
    mockPrisma.annualLeaveGrant.create.mockResolvedValue({ id: "g" })
    const r = await grantOnHire("dec", { actorId: "hr", today: d("2026-12-05") })
    expect(r.created).toEqual(["PRORATA:2026", "ANNUAL:2027"])
  })

  it("補建 2025 年到職者 → 2025 首年 + 2026 年度", async () => {
    const u = { id: "old", name: "Old", hireDate: d("2025-05-01"), terminatedDate: null }
    mockPrisma.user.findUnique.mockResolvedValue(u)
    mockPrisma.user.findMany.mockResolvedValue([u])
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null)
    mockPrisma.annualLeaveGrant.create.mockResolvedValue({ id: "g" })
    const r = await grantOnHire("old", { actorId: "hr", today: d("2026-10-01") })
    expect(r.created).toEqual(["PRORATA:2025", "ANNUAL:2026"])
  })

  it("有期初 → 不寫首年", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "x", name: "X", hireDate: d("2023-08-14"), terminatedDate: null })
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue({ id: "op", effectiveAt: d("2026-01-01") })
    const r = await grantOnHire("x", { actorId: "hr", today: d("2026-10-01") })
    expect(r.created).toEqual([])
    expect(mockPrisma.annualLeaveGrant.create).not.toHaveBeenCalled()
  })
})

describe("voidGrantsAfterTermination", () => {
  it("作廢生效日 >= 離職日的 PRORATA/ANNUAL，並清空 periodKey", async () => {
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([{ id: "g27", kind: "ANNUAL", year: 2027, amount: 10 }])
    mockPrisma.annualLeaveGrant.updateMany.mockResolvedValue({ count: 1 })
    const r = await voidGrantsAfterTermination("u", d("2027-01-01"), "hr")
    expect(mockPrisma.annualLeaveGrant.findMany.mock.calls[0][0].where).toMatchObject({
      userId: "u", voidedAt: null, kind: { in: ["PRORATA", "ANNUAL"] }, effectiveAt: { gte: d("2027-01-01") },
    })
    expect(mockPrisma.annualLeaveGrant.updateMany.mock.calls[0][0].data).toMatchObject({ periodKey: null, voidedById: "hr" })
    expect(r).toHaveLength(1)
  })
})

describe("previewHireDateRecalc", () => {
  it("previewRecalc 到職年改變：舊 PRORATA:2026 作廢、新增 PRORATA:2025 與 ANNUAL:2026", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u", name: "U", hireDate: d("2025-11-01"), terminatedDate: null })
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null)
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([
      { id: "old", kind: "PRORATA", year: 2026, periodKey: "PRORATA:2026", amount: 2.5, effectiveAt: d("2026-10-01"), basis: { hireDate: "2026-10-01" } },
    ])
    const changes = await previewHireDateRecalc("u", d("2026-10-01"))
    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ periodKey: "PRORATA:2026", oldAmount: 2.5, newAmount: null }),
      expect.objectContaining({ periodKey: "PRORATA:2025", oldAmount: null, newAmount: 1.5 }),
      expect.objectContaining({ periodKey: "ANNUAL:2026", oldAmount: null, newAmount: 10 }),
    ]))
  })

  it("天數與生效日都沒變 → 不列入", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "u", name: "U", hireDate: d("2026-10-01"), terminatedDate: null })
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null)
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([
      { id: "p", kind: "PRORATA", year: 2026, periodKey: "PRORATA:2026", amount: 2.5, effectiveAt: d("2026-10-01"), basis: { hireDate: "2026-10-01" } },
    ])
    expect(await previewHireDateRecalc("u", d("2026-10-01"))).toEqual([])
  })
})

describe("previewHireDateRecalc 不重算到職日沒變的紀錄", () => {
  it("遷移來的首年 5.5（舊天數算法），到職日沒變 → 不列入（不改成月份制 5）", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "leo", name: "Leo", hireDate: d("2026-06-15"), terminatedDate: null })
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null)
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([
      { id: "m", kind: "PRORATA", year: 2026, periodKey: "PRORATA:2026", amount: 5.5, effectiveAt: d("2026-06-15"), basis: { rule: "MIGRATED_PRORATA_DAYS", hireDate: "2026-06-15" } },
    ])
    expect(await previewHireDateRecalc("leo", d("2026-10-01"))).toEqual([])
  })

  it("已離職者的遷移年度發放，到職日沒變 → 不列入作廢", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "x", name: "X", hireDate: d("2020-03-01"), terminatedDate: d("2025-06-30") })
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null)
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([
      { id: "p", kind: "PRORATA", year: 2020, periodKey: "PRORATA:2020", amount: 8, effectiveAt: d("2020-03-01"), basis: { hireDate: "2020-03-01" } },
      { id: "a26", kind: "ANNUAL", year: 2026, periodKey: "ANNUAL:2026", amount: 15, effectiveAt: d("2026-01-01"), basis: { hireDate: "2020-03-01" } },
    ])
    const changes = await previewHireDateRecalc("x", d("2026-10-01"))
    expect(changes.find((c) => c.periodKey === "ANNUAL:2026")).toBeUndefined()
  })

  it("到職日同一年內改了 → 首年與年度都依新到職日重算", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "s", name: "S", hireDate: d("2025-08-01"), terminatedDate: null })
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null)
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([
      { id: "p", kind: "PRORATA", year: 2025, periodKey: "PRORATA:2025", amount: 3, effectiveAt: d("2025-08-24"), basis: { hireDate: "2025-08-24" } },
      { id: "a", kind: "ANNUAL", year: 2026, periodKey: "ANNUAL:2026", amount: 10, effectiveAt: d("2026-01-01"), basis: { hireDate: "2025-08-24" } },
    ])
    const changes = await previewHireDateRecalc("s", d("2026-10-01"))
    expect(changes).toEqual([
      expect.objectContaining({ periodKey: "ANNUAL:2026", oldId: "a", oldAmount: 10, newAmount: 10 }),
      expect.objectContaining({ periodKey: "PRORATA:2025", oldId: "p", oldAmount: 3, newAmount: 4 }),
    ])
  })
})

describe("voidGrant / setOpening", () => {
  it("已作廢的不能再作廢", async () => {
    mockPrisma.annualLeaveGrant.findUnique.mockResolvedValue({ id: "g", voidedAt: d("2026-10-01") })
    await expect(voidGrant("g", "x", "hr")).rejects.toThrow("此紀錄已作廢")
  })

  it("期初餘額不能用一般作廢（要走清除期初，才會同步舊欄位並重算）", async () => {
    mockPrisma.annualLeaveGrant.findUnique.mockResolvedValue({ id: "op", kind: "OPENING", voidedAt: null })
    await expect(voidGrant("op", "x", "hr")).rejects.toThrow("期初餘額請用「清除期初」")
    expect(mockPrisma.annualLeaveGrant.update).not.toHaveBeenCalled()
  })

  it("清除期初後：沒有任何系統發放 → 預覽補回首年與各年度", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "j", name: "J", hireDate: d("2023-08-14"), terminatedDate: null })
    mockPrisma.annualLeaveGrant.findFirst.mockResolvedValue(null) // 期初已作廢
    mockPrisma.annualLeaveGrant.findMany.mockResolvedValue([])
    const changes = await previewHireDateRecalc("j", d("2026-10-01"))
    expect(changes.map((c) => c.periodKey)).toEqual(["ANNUAL:2024", "ANNUAL:2025", "ANNUAL:2026", "PRORATA:2023"])
  })

  it("作廢原因必填", async () => {
    await expect(voidGrant("g", "  ", "hr")).rejects.toThrow("作廢原因必填")
  })

  it("setOpening 先作廢舊期初再寫新的", async () => {
    mockPrisma.annualLeaveGrant.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.annualLeaveGrant.create.mockResolvedValue({ id: "new" })
    await setOpening({ userId: "u", balance: 12, at: d("2026-01-01"), actorId: "hr" })
    expect(mockPrisma.annualLeaveGrant.updateMany.mock.calls[0][0]).toMatchObject({
      where: { userId: "u", kind: "OPENING", voidedAt: null },
      data: { voidReason: "期初餘額重設" },
    })
    expect(mockPrisma.annualLeaveGrant.create.mock.calls[0][0].data).toMatchObject({ kind: "OPENING", amount: 12, source: "HR_MANUAL" })
  })
})
