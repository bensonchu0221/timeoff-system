// 一次性：將「婚假」「喪假」設 requireProof=true。
// 之後新增假別在 admin 後台直接勾選即可，不需要再跑這支。
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

async function main() {
  const before = await prisma.leaveType.findMany({
    select: { id: true, name: true, requireProof: true, isActive: true },
    orderBy: { createdAt: "asc" },
  })
  console.log("=== Before ===")
  for (const t of before) {
    console.log(`  [${t.isActive ? "active" : "soft-deleted"}] ${t.requireProof ? "✓" : " "} ${t.name}`)
  }

  const targetNames = ["婚假", "喪假"]
  const targets = before.filter(t => targetNames.includes(t.name) && t.isActive)
  if (targets.length === 0) {
    console.log("\n找不到「婚假」或「喪假」（在職假別），請確認名稱。")
    return
  }

  const result = await prisma.leaveType.updateMany({
    where: { id: { in: targets.map(t => t.id) } },
    data: { requireProof: true },
  })
  console.log(`\nUpdated ${result.count} row(s).`)

  const after = await prisma.leaveType.findMany({
    select: { id: true, name: true, requireProof: true, isActive: true },
    orderBy: { createdAt: "asc" },
  })
  console.log("\n=== After ===")
  for (const t of after) {
    console.log(`  [${t.isActive ? "active" : "soft-deleted"}] ${t.requireProof ? "✓" : " "} ${t.name}`)
  }
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
