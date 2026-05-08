const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const types = await prisma.leaveType.findMany()
  console.log("Leave Types:", types)
}
main().catch(console.error).finally(() => prisma.$disconnect())
