// 作廢指定員工的首年 PRORATA，改寫為 A 算法（月份制）。預設 dry-run。
// 用法：npx tsx --env-file=.env scripts/annual-grant-fix-prorata.ts --names Aaron,Sophia --actor <ADMIN email> [--apply]
import { prisma } from "../src/lib/db"
import { calcProRataGrant, periodKey } from "../src/lib/annual-grant-calc"
import { getAnnualLeaveType } from "../src/lib/annual-grant"

const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined }

async function main() {
  const apply = process.argv.includes("--apply")
  const names = (arg("--names") ?? "").split(",").filter(Boolean)
  const actor = await prisma.user.findUniqueOrThrow({ where: { email: arg("--actor") ?? "" } })
  if (actor.role !== "ADMIN") throw new Error("--actor 必須是 ADMIN")
  const lt = await getAnnualLeaveType()
  const reason = "首年改依月份計算（HR 2026-10-01 確認）"

  for (const name of names) {
    const u = await prisma.user.findFirstOrThrow({ where: { name } })
    const year = u.hireDate!.getUTCFullYear()
    const old = await prisma.annualLeaveGrant.findFirstOrThrow({ where: { userId: u.id, periodKey: periodKey("PRORATA", year), voidedAt: null } })
    const next = calcProRataGrant(u.hireDate!, lt.defaultDays)
    console.log(`${name}：${old.amount} → ${next.amount}（${next.basis.text}）`)
    if (!apply) continue
    await prisma.$transaction([
      prisma.annualLeaveGrant.update({ where: { id: old.id }, data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason, periodKey: null } }),
      prisma.annualLeaveGrant.create({
        data: {
          userId: u.id, kind: "PRORATA", year, effectiveAt: u.hireDate!, amount: next.amount, basis: next.basis,
          reason, source: "RECALC", createdById: actor.id, periodKey: periodKey("PRORATA", year),
        },
      }),
    ])
    await prisma.auditLog.create({
      data: { actorId: actor.id, action: "ANNUAL_GRANT_RECALC", targetType: "User", targetId: u.id, payload: { from: old.amount, to: next.amount, reason } },
    })
  }
  console.log(apply ? "已寫入" : "dry-run，未寫入")
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
