import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

// 一次性 ops 腳本：批次補齊員工到職日（match by English name = User.name）
// 名單來源：HR 提供（2026-05-18），中文名僅做識別用
// 注意：本腳本不寫 AuditLog（一次性遷移，無 actor user）
const employees: { name: string; chineseName: string; hireDate: string }[] = [
  { name: "Connie",  chineseName: "申芳萍", hireDate: "2017-04-19" },
  { name: "Daniel",  chineseName: "陳維晟", hireDate: "2018-08-27" },
  { name: "Amber",   chineseName: "王亞昀", hireDate: "2019-02-11" },
  { name: "Jessica", chineseName: "林玉茹", hireDate: "2021-02-22" },
  { name: "Joy",     chineseName: "林仲軍", hireDate: "2023-08-14" },
  { name: "LuLu",    chineseName: "黃乙姍", hireDate: "2024-03-11" },
  { name: "Ted",     chineseName: "陳柏昇", hireDate: "2024-03-11" },
  { name: "Benson",  chineseName: "朱泳玄", hireDate: "2024-05-13" },
  { name: "Maggie",  chineseName: "王俐文", hireDate: "2024-03-13" },
  { name: "Tina",    chineseName: "劉又瑄", hireDate: "2024-09-02" },
  { name: "Naomi",   chineseName: "王悅軒", hireDate: "2025-02-04" },
  { name: "Wenny",   chineseName: "李育萱", hireDate: "2025-02-04" },
  { name: "Kalvin",  chineseName: "李承孝", hireDate: "2025-04-07" },
  { name: "Leo",     chineseName: "傅希碩", hireDate: "2025-11-03" },
  { name: "Joyce",   chineseName: "王婉如", hireDate: "2025-11-10" },
  { name: "Emma",    chineseName: "張維芬", hireDate: "2026-02-23" },
  { name: "Daniel",  chineseName: "張建華", hireDate: "2026-02-23" },
  { name: "Jasper",  chineseName: "顏靖育", hireDate: "2026-03-02" },
  { name: "Teresa",  chineseName: "吳佳純", hireDate: "2026-03-02" },
  { name: "Alvin",   chineseName: "鄭尹茜", hireDate: "2026-05-04" },
]

async function main() {
  const counters = { ok: 0, notFound: 0, ambiguous: 0, skipped: 0, dupName: 0 }

  // 預先找出「名單內重名」的英文名（例如兩位 Daniel），這類整組跳過要 manual 處理
  // 避免：第一個 Daniel 寫入 → 第二個 Daniel findMany 又只撈到同一筆 → 被覆寫
  const nameCount = new Map<string, number>()
  for (const e of employees) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1)
  const dupNames = new Set(Array.from(nameCount.entries()).filter(([, c]) => c > 1).map(([n]) => n))

  for (const emp of employees) {
    // 名單內重名 → 不自動寫入（避免覆蓋）
    if (dupNames.has(emp.name)) {
      console.log(`[DUP NAME] ${emp.name} (${emp.chineseName}) — 名單內有多位同英文名員工，請手動於 /admin/users 設定 ${emp.hireDate}`)
      counters.dupName++
      continue
    }

    // 用 UTC 0:00 寫入避免時區位移成前一天
    const hireDateUtc = new Date(`${emp.hireDate}T00:00:00.000Z`)

    const matches = await prisma.user.findMany({
      where: { name: emp.name, terminatedDate: null },
      select: { id: true, name: true, email: true, hireDate: true },
    })

    if (matches.length === 0) {
      console.log(`[NOT FOUND] ${emp.name} (${emp.chineseName}) — 系統中查無此英文名員工，需手動建檔`)
      counters.notFound++
      continue
    }

    if (matches.length > 1) {
      console.log(`[AMBIGUOUS] ${emp.name} 有 ${matches.length} 筆，請手動於 /admin/users 設定：`)
      for (const m of matches) {
        const cur = m.hireDate ? m.hireDate.toISOString().slice(0, 10) : "未設定"
        console.log(`  - id=${m.id} email=${m.email} 現有 hireDate=${cur}`)
      }
      counters.ambiguous++
      continue
    }

    const u = matches[0]
    const cur = u.hireDate ? u.hireDate.toISOString().slice(0, 10) : null
    if (cur === emp.hireDate) {
      console.log(`[SKIP] ${emp.name} (${emp.chineseName}) hireDate 已是 ${cur}，無需更新`)
      counters.skipped++
      continue
    }

    await prisma.user.update({
      where: { id: u.id },
      data: { hireDate: hireDateUtc },
    })
    console.log(`[OK] ${emp.name} (${emp.chineseName}) ${cur ?? "(空)"} → ${emp.hireDate}`)
    counters.ok++
  }

  console.log("\n=== Summary ===")
  console.log(`已更新：${counters.ok}`)
  console.log(`已是最新（跳過）：${counters.skipped}`)
  console.log(`找不到（需手動建檔）：${counters.notFound}`)
  console.log(`系統內重名歧義（需手動處理）：${counters.ambiguous}`)
  console.log(`名單內同英文名（需手動處理）：${counters.dupName}`)
}

main()
  .catch((e) => {
    console.error("Seed failed:", e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
