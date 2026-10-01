// 指定員工的首年 PRORATA 改為 A 算法（月份制）：直接更新原紀錄（天數、計算依據、原因），
// 舊值記在 AuditLog（from → to）。預設 dry-run。
// 用法：npx tsx --env-file=.env scripts/annual-grant-fix-prorata.ts --names Aaron,Sophia --actor <ADMIN email> [--apply]
import { prisma } from "../src/lib/db"
import { calcProRataGrant, periodKey } from "../src/lib/annual-grant-calc"
import { getAnnualLeaveType } from "../src/lib/annual-grant"
import { getUserLeaveBalance } from "../src/lib/leave-utils"

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
    const bal = await getUserLeaveBalance(u.id, lt.id)
    const delta = next.amount - old.amount
    console.log(`${name}（${u.chineseName ?? ""}，到職 ${u.hireDate!.toISOString().slice(0, 10)}）`)
    console.log(`  紀錄 ${old.id}`)
    console.log(`  天數：${old.amount} → ${next.amount}`)
    console.log(`  依據：${(old.basis as { text?: string } | null)?.text} → ${next.basis.text}`)
    console.log(`  餘額：總額 ${bal.total} → ${bal.total + delta}，已用 ${bal.used}，待審 ${bal.pending}，剩餘 ${bal.remaining} → ${bal.remaining + delta}`)
    if (!apply) continue
    await prisma.$transaction([
      prisma.annualLeaveGrant.update({ where: { id: old.id }, data: { amount: next.amount, basis: next.basis, reason } }),
      prisma.auditLog.create({
        data: {
          actorId: actor.id, action: "ANNUAL_GRANT_RECALC", targetType: "AnnualLeaveGrant", targetId: old.id,
          payload: { userId: u.id, name, from: { amount: old.amount, basis: old.basis }, to: { amount: next.amount, basis: next.basis }, reason, mode: "in-place" },
        },
      }),
    ])
  }
  console.log(apply ? "\n已寫入（直接更新原紀錄 + 稽核紀錄）" : "\ndry-run，未寫入")
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
