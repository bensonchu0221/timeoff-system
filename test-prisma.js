const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL })
async function main() {
  await prisma.$connect()
  console.log("Connected!")
}
main().catch(console.error).finally(() => prisma.$disconnect())
