const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.update({
    where: { email: 'benson@popin.cc' },
    data: { role: 'ADMIN' },
  })
  console.log("User updated successfully to ADMIN:", user.email, user.role)
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect())
