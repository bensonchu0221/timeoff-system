import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

// 一次性修復：seed-hire-dates.ts 因為重名邏輯有 bug，
// 把陳維晟 Daniel (daniel@popin.cc) 的 hireDate 從 2018-08-27 誤覆寫成張建華的 2026-02-23
// 此腳本把陳維晟改回 2018-08-27
async function main() {
  const email = "daniel@popin.cc"
  const correctHire = new Date("2018-08-27T00:00:00.000Z")

  const before = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, hireDate: true },
  })
  if (!before) {
    console.log(`[ERROR] 找不到 email=${email}`)
    return
  }
  const beforeHd = before.hireDate ? before.hireDate.toISOString().slice(0, 10) : "(無)"
  console.log(`修復前：${before.name} (${before.email}) hireDate=${beforeHd}`)

  await prisma.user.update({
    where: { email },
    data: { hireDate: correctHire },
  })

  const after = await prisma.user.findUnique({
    where: { email },
    select: { hireDate: true },
  })
  const afterHd = after?.hireDate ? after.hireDate.toISOString().slice(0, 10) : "(無)"
  console.log(`修復後：hireDate=${afterHd}`)
  console.log("✅ 完成")
}

main().catch(console.error).finally(() => prisma.$disconnect())
