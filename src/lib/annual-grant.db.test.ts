import { describe, it, expect, beforeAll, afterAll } from "vitest"

// 保護：絕對不能打到 Cloud SQL
const url = process.env.DATABASE_URL ?? ""
if (!url.includes("127.0.0.1:3307")) throw new Error(`DB 測試只能連本機 Docker（127.0.0.1:3307），目前：${url}`)

import { prisma } from "./db"
import { grantAnnualForYear, voidGrant } from "./annual-grant"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

beforeAll(async () => {
  await prisma.department.create({ data: { id: "dept", name: "測試部" } })
  await prisma.leaveType.create({ data: { id: "lt", name: "特休", defaultDays: 10, isActive: true } })
  await prisma.user.create({ data: { id: "u1", email: "u1@t", name: "U1", departmentId: "dept", hireDate: d("2020-01-01") } })
})

afterAll(async () => { await prisma.$disconnect() })

describe("AnnualLeaveGrant 唯一鍵（真實 MySQL）", () => {
  it("並行 5 次發同一年 → 只有 1 筆成功", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => grantAnnualForYear(2027, { userIds: ["u1"], source: "SYSTEM_CRON" })),
    )
    expect(results.reduce((n, r) => n + r.granted.length, 0)).toBe(1)
    expect(await prisma.annualLeaveGrant.count({ where: { userId: "u1", periodKey: "ANNUAL:2027" } })).toBe(1)
  })

  it("作廢後 periodKey 清空，可重新發放", async () => {
    const g = await prisma.annualLeaveGrant.findFirstOrThrow({ where: { userId: "u1", periodKey: "ANNUAL:2027" } })
    await voidGrant(g.id, "測試", "u1")
    const r = await grantAnnualForYear(2027, { userIds: ["u1"], source: "HR_BUTTON" })
    expect(r.granted).toHaveLength(1)
    expect(await prisma.annualLeaveGrant.count({ where: { userId: "u1", year: 2027 } })).toBe(2)
  })

  it("ADJUSTMENT（periodKey = null）同人可多筆", async () => {
    for (const amount of [1, 2]) {
      await prisma.annualLeaveGrant.create({
        data: { userId: "u1", kind: "ADJUSTMENT", effectiveAt: d("2026-10-01"), amount, source: "HR_MANUAL", periodKey: null },
      })
    }
    expect(await prisma.annualLeaveGrant.count({ where: { userId: "u1", kind: "ADJUSTMENT" } })).toBe(2)
  })
})
