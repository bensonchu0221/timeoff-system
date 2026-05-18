import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  const daniels = await prisma.user.findMany({
    where: { name: "Daniel" },
    select: { id: true, name: true, email: true, hireDate: true, terminatedDate: true },
  })
  console.log(`系統中 name="Daniel" 的員工共 ${daniels.length} 筆：`)
  for (const d of daniels) {
    const hd = d.hireDate ? d.hireDate.toISOString().slice(0, 10) : "(無)"
    const td = d.terminatedDate ? d.terminatedDate.toISOString().slice(0, 10) : "在職"
    console.log(`  id=${d.id}  email=${d.email}  hireDate=${hd}  狀態=${td}`)
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
