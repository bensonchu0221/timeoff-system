import { PrismaClient } from "@prisma/client"
const prisma = new PrismaClient()

async function seedHolidays() {
  const holidays = [
    { date: new Date("2026-01-01"), name: "元旦", isWorkDay: false },
    { date: new Date("2026-02-16"), name: "春節", isWorkDay: false },
    { date: new Date("2026-02-17"), name: "春節", isWorkDay: false },
    { date: new Date("2026-02-18"), name: "春節", isWorkDay: false },
    { date: new Date("2026-02-19"), name: "春節", isWorkDay: false },
    { date: new Date("2026-02-20"), name: "春節", isWorkDay: false },
    { date: new Date("2026-02-28"), name: "和平紀念日", isWorkDay: false },
    { date: new Date("2026-04-03"), name: "兒童節", isWorkDay: false },
    { date: new Date("2026-04-06"), name: "清明節 (補假)", isWorkDay: false },
    { date: new Date("2026-06-19"), name: "端午節", isWorkDay: false },
    { date: new Date("2026-09-25"), name: "中秋節", isWorkDay: false },
    { date: new Date("2026-10-09"), name: "國慶日 (彈性放假)", isWorkDay: false },
    { date: new Date("2026-10-10"), name: "國慶日", isWorkDay: false },
  ]

  console.log("Seeding holidays...")
  for (const h of holidays) {
    await prisma.holiday.upsert({
      where: { date: h.date },
      update: h,
      create: h
    })
  }
  console.log("Done!")
}

seedHolidays().catch(console.error).finally(() => prisma.$disconnect())
