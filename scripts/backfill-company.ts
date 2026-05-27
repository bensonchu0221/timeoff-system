import { PrismaClient, Company } from "@prisma/client"

const prisma = new PrismaClient()

// 一次性 ops 腳本：依 HR 隸屬表回填每位員工的所屬公司（company）。
// key 用「中文姓名」而非 email —— 因 email 後綴 ≠ 實際公司（例：lulu@popin.cc 實屬鉑芯）。
// 找不到的中文名、以及回填後仍 company=null 的在職員工，會列出供人工檢查。

type Entry = { chineseName: string; company: Company }

const roster: Entry[] = [
  // 博英（POPIN，15）
  { chineseName: "申芳萍", company: "POPIN" },
  { chineseName: "王亞昀", company: "POPIN" },
  { chineseName: "林玉茹", company: "POPIN" },
  { chineseName: "陳新慧", company: "POPIN" },
  { chineseName: "陳維晟", company: "POPIN" },
  { chineseName: "朱詠玄", company: "POPIN" },
  { chineseName: "林仲軍", company: "POPIN" },
  { chineseName: "楊心慈", company: "POPIN" },
  { chineseName: "傅希碩", company: "POPIN" },
  { chineseName: "詹馨怡", company: "POPIN" },
  { chineseName: "張維芬", company: "POPIN" },
  { chineseName: "張建華", company: "POPIN" },
  { chineseName: "顏靖育", company: "POPIN" },
  { chineseName: "吳佳純", company: "POPIN" },
  { chineseName: "劉芷蔚", company: "POPIN" },
  // 鉑芯（BROADCIEL，9）
  { chineseName: "黃乙姍", company: "BROADCIEL" },
  { chineseName: "陳柏昇", company: "BROADCIEL" },
  { chineseName: "王俐文", company: "BROADCIEL" },
  { chineseName: "劉又瑄", company: "BROADCIEL" },
  { chineseName: "王悅軒", company: "BROADCIEL" },
  { chineseName: "李育萱", company: "BROADCIEL" },
  { chineseName: "張嘉榮", company: "BROADCIEL" },
  { chineseName: "李承孝", company: "BROADCIEL" },
  { chineseName: "王婉如", company: "BROADCIEL" },
]

async function main() {
  const counters = { updated: 0, alreadySet: 0, notFound: 0 }

  for (const entry of roster) {
    const user = await prisma.user.findFirst({ where: { chineseName: entry.chineseName } })
    if (!user) {
      console.log(`[NOT FOUND] ${entry.chineseName}（DB 找不到此中文名）`)
      counters.notFound++
      continue
    }
    if (user.company === entry.company) {
      console.log(`[SKIP] ${entry.chineseName} 已是 ${entry.company}`)
      counters.alreadySet++
      continue
    }
    await prisma.user.update({ where: { id: user.id }, data: { company: entry.company } })
    console.log(`[OK] ${entry.chineseName}（${user.name ?? "?"}）company: ${user.company ?? "(空)"} → ${entry.company}`)
    counters.updated++
  }

  // 回填後，仍未設定公司的在職員工（須人工於後台補設）
  const stillNull = await prisma.user.findMany({
    where: { terminatedDate: null, company: null },
    select: { name: true, chineseName: true, email: true },
    orderBy: { email: "asc" },
  })

  console.log("\n=== Summary ===")
  console.log(`更新：${counters.updated}`)
  console.log(`已正確（跳過）：${counters.alreadySet}`)
  console.log(`HR 名單找不到：${counters.notFound}`)
  console.log(`在職但仍未設定公司：${stillNull.length}`)
  for (const u of stillNull) {
    console.log(`  - ${u.chineseName ?? "(無中文名)"} / ${u.name ?? "?"} / ${u.email}`)
  }
}

main().catch((e) => {
  console.error("Backfill failed:", e)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
