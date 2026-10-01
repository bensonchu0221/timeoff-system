// 特休遷移零差異審核報表。
// 用法：npx tsx --env-file=.env scripts/annual-grant-audit.ts --out <path.csv>
// 每位員工 × 多個時間點比對：舊公式（legacyAnnualBalance）vs 新表（getUserLeaveBalance）。
// 時間點 >= 2027-01-01 標記為「預期差異」（新表要等 12/1 或 HR 按鈕才有明年發放）。
// 另外逐筆比對歷史假單的發放事件（舊版 ledger 邏輯 vs 新版 getLeaveLedger）。
import { writeFileSync } from "fs"
import { prisma } from "../src/lib/db"
import { legacyAnnualBalance, legacyLedgerGrantEvents } from "../src/lib/legacy-annual-calc"
import { getLeaveLedger } from "../src/lib/ledger-utils"
import { getUserLeaveBalance } from "../src/lib/leave-utils"
import { getAnnualLeaveType } from "../src/lib/annual-grant"

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

async function main() {
  const outIdx = process.argv.indexOf("--out")
  if (outIdx < 0) throw new Error("需要 --out <path.csv>")
  const out = process.argv[outIdx + 1]
  const lt = await getAnnualLeaveType()
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } })
  const expectedFrom = d("2027-01-01")

  const lines = ["姓名,狀態,時間點,舊總額,新總額,差異,已用,待審,舊剩餘,新剩餘,剩餘差異,類別"]
  let unexpected = 0, expected = 0
  for (const u of users) {
    const grants = await prisma.annualLeaveGrant.findMany({ where: { userId: u.id, voidedAt: null }, select: { effectiveAt: true } })
    const points = new Set<string>([new Date().toISOString().slice(0, 10), "2025-12-31", "2026-12-31", "2027-01-01"])
    for (const g of grants) {
      points.add(g.effectiveAt.toISOString().slice(0, 10))
      points.add(new Date(g.effectiveAt.getTime() - 86_400_000).toISOString().slice(0, 10))
    }
    for (const p of [...points].sort()) {
      const asOf = d(p)
      const oldB = await legacyAnnualBalance(u.id, lt.id, asOf)
      const newB = await getUserLeaveBalance(u.id, lt.id, asOf)
      const diff = newB.total - oldB.total
      const remDiff = newB.remaining - oldB.remaining
      const isExpected = asOf >= expectedFrom
      const kind = diff === 0 && remDiff === 0 ? "一致" : isExpected ? "預期差異" : "❌ 非預期差異"
      if (kind === "❌ 非預期差異") unexpected++
      if (kind === "預期差異") expected++
      lines.push([u.name, u.terminatedDate ? "離職" : "在職", p, oldB.total, newB.total, diff, newB.used, newB.pending, oldB.remaining, newB.remaining, remDiff, kind].join(","))
    }
  }
  // 歷史假單逐筆比對（發放類事件：日期 + 天數）
  const key = (e: { date: Date; amount: number }) => `${e.date.toISOString().slice(0, 10)} ${e.amount}`
  let ledgerMismatch = 0
  lines.push("", "姓名,歷史假單,只在舊版,只在新版")
  for (const u of users) {
    const overrides = await prisma.userLeaveBalance.findMany({
      where: { userId: u.id, leaveTypeId: lt.id }, orderBy: { year: "asc" }, select: { year: true, totalQuota: true },
    })
    const adjustments = await prisma.leaveAdjustment.findMany({
      where: { userId: u.id, leaveTypeId: lt.id }, orderBy: { effectiveAt: "asc" }, select: { effectiveAt: true, amount: true },
    })
    const opening = u.annualLeaveOpeningBalance !== null && u.annualLeaveOpeningAt !== null
      ? { balance: u.annualLeaveOpeningBalance, at: u.annualLeaveOpeningAt } : null
    const legacy = legacyLedgerGrantEvents({ hireDate: u.hireDate, opening, overrides, adjustments, defaultDays: lt.defaultDays, now: new Date() }).map(key)
    const fresh = (await getLeaveLedger(u.id, lt.id)).filter((e) => e.id.startsWith("grant-")).map((e) => key({ date: e.date, amount: e.amount }))
    const onlyOld = legacy.filter((k) => { const i = fresh.indexOf(k); if (i < 0) return true; fresh.splice(i, 1); return false })
    const ok = onlyOld.length === 0 && fresh.length === 0
    if (!ok) ledgerMismatch++
    lines.push([u.name, ok ? "一致" : "❌ 不一致", onlyOld.join(" / "), fresh.join(" / ")].join(","))
  }

  const future = await prisma.leaveRequest.findMany({
    where: { leaveTypeId: lt.id, status: { in: ["APPROVED", "PENDING"] }, startDate: { gte: expectedFrom } },
    select: { id: true, userId: true, startDate: true, durationDays: true },
  })
  writeFileSync(out, "﻿" + lines.join("\n"))
  console.log(`報表：${out}`)
  console.log(`非預期差異：${unexpected} 筆；預期差異（2027 以後）：${expected} 筆；歷史假單不一致：${ledgerMismatch} 人；已預約 2027 以後特休：${future.length} 張`)
  if (future.length) console.log(future)
  if (unexpected > 0 || ledgerMismatch > 0) process.exitCode = 2
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
