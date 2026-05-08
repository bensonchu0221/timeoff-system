const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  await prisma.leaveType.createMany({
    data: [
      { name: '特休', defaultDays: 14, isPaid: true },
      { name: '病假', defaultDays: 30, isPaid: true },
      { name: '事假', defaultDays: 14, isPaid: false }
    ],
    skipDuplicates: true,
  })
  console.log("Leave types created")
}
main().catch(console.error).finally(() => prisma.$disconnect())
