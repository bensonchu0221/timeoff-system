import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

// 一次性檢查腳本：列出所有在職員工的關鍵欄位狀態
// 確認 21 位 HR 名單是否都建檔、name / hireDate 是否對齊
async function main() {
  const users = await prisma.user.findMany({
    where: { terminatedDate: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, hireDate: true, department: true },
  })
  console.log(`在職員工共 ${users.length} 位：\n`)
  console.log("英文名".padEnd(12), "email".padEnd(35), "hireDate".padEnd(12), "部門")
  console.log("-".repeat(80))
  for (const u of users) {
    const hd = u.hireDate ? u.hireDate.toISOString().slice(0, 10) : "(未設)"
    const dept = u.department ?? "(未設)"
    console.log(
      (u.name ?? "(無名)").padEnd(12),
      u.email.padEnd(35),
      hd.padEnd(12),
      dept
    )
  }
}

main().catch(console.error).finally(() => prisma.$disconnect())
