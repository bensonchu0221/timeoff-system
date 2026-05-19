import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

// 一次性 ops 腳本：2026-05-19 切換新特休邏輯時，把所有員工的：
//   1. chineseName backfill
//   2. hireDate 修正（如有偏差）
//   3. 特休 opening balance（針對 2025 之前入職的員工，依公式算出）
//   4. 特休 override（針對 B ≠ 基準 的員工）
// 一次寫入 prod DB
//
// 公式：opening = round((hireDate月份/12) × B + R, 0.5)
// openingAt 統一 = 2026-01-01

const OPENING_AT_ISO = "2026-01-01"

type Entry = {
  email: string
  name: string           // 預期 DB 內 name 應對齊此值；若不一致會被更正
  chineseName: string
  hireDate: string       // YYYY-MM-DD
  opening?: number       // null 表示不設 opening（2026 入職者）
  overrideDays?: number  // 特休 override（B ≠ 基準才設）；不設則跳過
}

const employees: Entry[] = [
  { email: "connie@popin.cc",            name: "Connie",  chineseName: "申芳萍", hireDate: "2017-04-19", opening: 117,  overrideDays: 20 },
  { email: "daniel@popin.cc",            name: "Daniel",  chineseName: "陳維晟", hireDate: "2018-08-27", opening: 17.5, overrideDays: 16 },
  { email: "amber@popin.cc",             name: "Amber",   chineseName: "王亞昀", hireDate: "2019-02-11", opening: 9.5 },
  { email: "jessica@popin.cc",           name: "Jessica", chineseName: "林玉茹", hireDate: "2021-02-22", opening: 14.5 },
  { email: "linzhongjyun@popin.cc",      name: "Joy",     chineseName: "林仲軍", hireDate: "2023-08-14", opening: 8.5 },
  { email: "lulu@popin.cc",              name: "Lulu",    chineseName: "黃乙姍", hireDate: "2024-03-11", opening: 5,    overrideDays: 15 },
  { email: "ted@popin.cc",               name: "Ted",     chineseName: "陳柏昇", hireDate: "2024-03-11", opening: 4.5,  overrideDays: 15 },
  { email: "benson@popin.cc",            name: "Benson",  chineseName: "朱詠玄", hireDate: "2024-05-13", opening: 7.5,  overrideDays: 15 },
  { email: "maggie@popin.cc",            name: "Maggie",  chineseName: "王俐文", hireDate: "2024-03-13", opening: 7,    overrideDays: 15 },
  { email: "tina@popin.cc",              name: "Tina",    chineseName: "劉又瑄", hireDate: "2024-09-02", opening: 17.5, overrideDays: 17 },
  { email: "naomi@broadciel.com",        name: "Naomi",   chineseName: "王悅軒", hireDate: "2025-02-04", opening: 2.5 },
  { email: "wenny@broadciel.com",        name: "Wenny",   chineseName: "李育萱", hireDate: "2025-02-04", opening: 1.5 },
  { email: "kalvin@broadciel.com",       name: "Kalvin",  chineseName: "李承孝", hireDate: "2025-04-07", opening: 15,   overrideDays: 15 },
  { email: "leo@popin.cc",               name: "Leo",     chineseName: "傅希碩", hireDate: "2025-11-03", opening: 10.5 },
  { email: "joyce@broadciel.com",        name: "Joyce",   chineseName: "王婉如", hireDate: "2025-11-10", opening: 10.5 },
  // 2026 入職：不設 opening、不設 override（走純新邏輯）
  { email: "emma@broadciel.com",         name: "Emma",    chineseName: "張維芬", hireDate: "2026-02-23" },
  { email: "daniel@broadciel.com",       name: "Daniel",  chineseName: "張建華", hireDate: "2026-02-23" },
  { email: "jasper@broadciel.com",       name: "Jasper",  chineseName: "顏靖育", hireDate: "2026-03-02" },
  { email: "teresa@broadciel.com",       name: "Teresa",  chineseName: "吳佳純", hireDate: "2026-03-02" },
  { email: "alvin@broadciel.com",        name: "Alvin",   chineseName: "鄭尹茜", hireDate: "2026-05-04" },
]

async function main() {
  const counters = { ok: 0, notFound: 0, openingSet: 0, overrideSet: 0, hireDateUpdated: 0, nameUpdated: 0 }

  // 找出特休 leaveType id
  const annualType = await prisma.leaveType.findFirst({
    where: { OR: [{ name: { contains: "特休" } }, { name: { contains: "annual" } }] },
    select: { id: true, name: true },
  })
  if (!annualType) {
    console.log("[ERROR] 找不到特休 LeaveType，請先建立")
    return
  }
  console.log(`使用特休 leaveType: ${annualType.name} (${annualType.id})\n`)

  for (const emp of employees) {
    const user = await prisma.user.findUnique({ where: { email: emp.email } })
    if (!user) {
      console.log(`[NOT FOUND] ${emp.email} (${emp.chineseName})`)
      counters.notFound++
      continue
    }

    const updates: Record<string, unknown> = {}
    const logs: string[] = []

    if (user.name !== emp.name) {
      updates.name = emp.name
      logs.push(`name: "${user.name}" → "${emp.name}"`)
      counters.nameUpdated++
    }
    if (user.chineseName !== emp.chineseName) {
      updates.chineseName = emp.chineseName
      logs.push(`chineseName: "${user.chineseName ?? ""}" → "${emp.chineseName}"`)
    }
    const expectedHire = new Date(`${emp.hireDate}T00:00:00.000Z`).getTime()
    if (!user.hireDate || user.hireDate.getTime() !== expectedHire) {
      updates.hireDate = new Date(`${emp.hireDate}T00:00:00.000Z`)
      const prevHd = user.hireDate ? user.hireDate.toISOString().slice(0, 10) : "(空)"
      logs.push(`hireDate: ${prevHd} → ${emp.hireDate}`)
      counters.hireDateUpdated++
    }
    if (emp.opening !== undefined) {
      const openingAt = new Date(`${OPENING_AT_ISO}T00:00:00.000Z`)
      if (user.annualLeaveOpeningBalance !== emp.opening || user.annualLeaveOpeningAt?.getTime() !== openingAt.getTime()) {
        updates.annualLeaveOpeningBalance = emp.opening
        updates.annualLeaveOpeningAt = openingAt
        logs.push(`opening: ${user.annualLeaveOpeningBalance ?? "(空)"} → ${emp.opening} @ ${OPENING_AT_ISO}`)
        counters.openingSet++
      }
    } else {
      // 2026 入職員工：確保 opening 為空（若之前有設則清掉）
      if (user.annualLeaveOpeningBalance !== null || user.annualLeaveOpeningAt !== null) {
        updates.annualLeaveOpeningBalance = null
        updates.annualLeaveOpeningAt = null
        logs.push(`opening: 清除（2026 入職員工不需 opening）`)
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data: updates })
    }

    // 特休 override
    if (emp.overrideDays !== undefined) {
      const year = 2026
      const existing = await prisma.userLeaveBalance.findUnique({
        where: { userId_leaveTypeId_year: { userId: user.id, leaveTypeId: annualType.id, year } },
      })
      if (!existing || existing.totalQuota !== emp.overrideDays) {
        await prisma.userLeaveBalance.upsert({
          where: { userId_leaveTypeId_year: { userId: user.id, leaveTypeId: annualType.id, year } },
          update: { totalQuota: emp.overrideDays },
          create: { userId: user.id, leaveTypeId: annualType.id, year, totalQuota: emp.overrideDays },
        })
        logs.push(`override: ${existing?.totalQuota ?? "(無)"} → ${emp.overrideDays} @ year=${year}`)
        counters.overrideSet++
      }
    }

    if (logs.length > 0) {
      console.log(`[OK] ${emp.name} (${emp.chineseName})`)
      for (const l of logs) console.log(`  - ${l}`)
      counters.ok++
    } else {
      console.log(`[SKIP] ${emp.name} (${emp.chineseName}) 無變動`)
    }
  }

  console.log("\n=== Summary ===")
  console.log(`找不到員工：${counters.notFound}`)
  console.log(`有變動的員工：${counters.ok}`)
  console.log(`English name 更正：${counters.nameUpdated}`)
  console.log(`hireDate 更正：${counters.hireDateUpdated}`)
  console.log(`opening 寫入：${counters.openingSet}`)
  console.log(`override 寫入：${counters.overrideSet}`)
}

main().catch((e) => {
  console.error("Seed failed:", e)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
