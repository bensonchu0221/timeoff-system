import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  await prisma.fAQ.create({
    data: {
      question: "請假幾天要事先知會主管？",
      answer: "超過 3 天（含）的年假都要先知會主管。",
      order: 1,
      category: "請假規則"
    }
  })
  console.log("Seed FAQ success")
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect())
