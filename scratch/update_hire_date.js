require('dotenv').config()
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const result = await prisma.user.updateMany({
    data: { hireDate: new Date('2026-01-01T00:00:00Z') }
  })
  console.log(`Updated ${result.count} users' hireDate.`)
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect())
