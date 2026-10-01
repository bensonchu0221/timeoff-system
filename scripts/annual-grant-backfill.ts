// 特休發放紀錄遷移回填。
// 用法：
//   npx tsx --env-file=.env scripts/annual-grant-backfill.ts            → dry-run，只印出將寫入的列
//   npx tsx --env-file=.env scripts/annual-grant-backfill.ts --apply    → 寫入（需使用者同意；本地與線上共用 DB）
import { prisma } from "../src/lib/db"
import { buildBackfillRows } from "../src/lib/backfill-plan"
import { getAnnualLeaveType } from "../src/lib/annual-grant"

async function main() {
  const apply = process.argv.includes("--apply")
  const now = new Date()
  const lt = await getAnnualLeaveType()

  const already = await prisma.annualLeaveGrant.count()
  if (already > 0) throw new Error(`AnnualLeaveGrant 已有 ${already} 筆，回填只能在空表執行`)

  const users = await prisma.user.findMany({ orderBy: { name: "asc" } })
  let total = 0
  for (const u of users) {
    const overrides = await prisma.userLeaveBalance.findMany({
      where: { userId: u.id, leaveTypeId: lt.id }, orderBy: { year: "asc" }, select: { year: true, totalQuota: true },
    })
    const adjustments = await prisma.leaveAdjustment.findMany({
      where: { userId: u.id, leaveTypeId: lt.id }, orderBy: { effectiveAt: "asc" },
      select: { effectiveAt: true, amount: true, reason: true, createdById: true },
    })
    const opening = u.annualLeaveOpeningBalance !== null && u.annualLeaveOpeningAt !== null
      ? { balance: u.annualLeaveOpeningBalance, at: u.annualLeaveOpeningAt } : null
    const rows = buildBackfillRows({ hireDate: u.hireDate, opening, overrides, adjustments, defaultDays: lt.defaultDays, now })
    for (const r of rows) {
      console.log(`${u.name}\t${r.kind}\t${r.year ?? ""}\t${r.effectiveAt.toISOString().slice(0, 10)}\t${r.amount}\t${r.basis.text}`)
    }
    total += rows.length
    if (apply && rows.length) {
      await prisma.annualLeaveGrant.createMany({
        data: rows.map((r) => ({ ...r, userId: u.id, source: "MIGRATION" as const })),
      })
    }
  }
  console.log(`\n${apply ? "已寫入" : "dry-run，將寫入"} ${total} 筆（${users.length} 位員工）`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
