import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const result = await prisma.user.updateMany({
    data: {
      hireDate: new Date('2026-01-01T00:00:00.000Z')
    }
  })
  console.log(`Updated ${result.count} users' hire dates to 2026-01-01.`)
}

main()
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
