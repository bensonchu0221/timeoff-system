"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/admin-guard"
import { logAudit } from "@/lib/audit"
import { todayStartUTCFromTaipei } from "@/lib/date-format"
import { allowedGrantYears } from "@/lib/annual-grant-calc"
import {
  previewAnnualForYear, grantAnnualForYear, addAdjustment, voidGrant,
  previewHireDateRecalc, applyHireDateRecalc,
} from "@/lib/annual-grant"

function revalidateAll() {
  revalidatePath("/admin/leave-settings")
  revalidatePath("/admin/users")
  revalidatePath("/")
}

function assertAllowedYear(year: number) {
  const allowed = allowedGrantYears(todayStartUTCFromTaipei())
  if (!allowed.includes(year)) throw new Error(`只能發放 ${allowed[0]} 或 ${allowed[1]} 年`)
}

const parseDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number)
  if (!y || !m || !d) throw new Error("日期格式錯誤")
  return new Date(Date.UTC(y, m - 1, d))
}

export async function previewAnnualGrantAction(year: number, userIds?: string[]) {
  await requireAdmin()
  assertAllowedYear(year)
  return previewAnnualForYear(year, { userIds })
}

export async function grantAnnualAction(year: number, userIds?: string[]) {
  const actorId = await requireAdmin()
  assertAllowedYear(year)
  const r = await grantAnnualForYear(year, { userIds, source: "HR_BUTTON", actorId })
  await logAudit({
    actorId, action: "ANNUAL_GRANT_ISSUE", targetType: "AnnualLeaveGrant", targetId: `ANNUAL:${year}`,
    payload: { year, userIds: userIds ?? "ALL", granted: r.granted.map((g) => ({ userId: g.userId, amount: g.amount })), skipped: r.skipped.length },
  })
  revalidateAll()
  return {
    success: true as const,
    message: `${year} 年度特休：發放 ${r.granted.length} 人、略過 ${r.skipped.length} 人（已發放）`,
    granted: r.granted.length,
    skipped: r.skipped.length,
  }
}

export async function addAnnualAdjustmentAction(input: { userId: string; effectiveAt: string; amount: number; reason: string }) {
  const actorId = await requireAdmin()
  const effectiveAt = parseDate(input.effectiveAt)
  const g = await addAdjustment({ userId: input.userId, effectiveAt, amount: input.amount, reason: input.reason, actorId })
  await logAudit({
    actorId, action: "ANNUAL_GRANT_ADJUST", targetType: "AnnualLeaveGrant", targetId: g.id,
    payload: { userId: input.userId, effectiveAt: input.effectiveAt, amount: input.amount, reason: input.reason },
  })
  revalidateAll()
  return { success: true as const, message: `已新增調整 ${input.amount > 0 ? "+" : ""}${input.amount} 天` }
}

export async function voidAnnualGrantAction(id: string, reason: string) {
  const actorId = await requireAdmin()
  if (!reason.trim()) throw new Error("作廢原因必填")
  const g = await voidGrant(id, reason, actorId)
  await logAudit({ actorId, action: "ANNUAL_GRANT_VOID", targetType: "AnnualLeaveGrant", targetId: id, payload: { ...g, reason } })
  revalidateAll()
  return { success: true as const, message: "已作廢" }
}

export async function previewRecalcAction(userId: string) {
  await requireAdmin()
  return previewHireDateRecalc(userId)
}

export async function applyRecalcAction(userId: string, reason: string) {
  const actorId = await requireAdmin()
  const changes = await applyHireDateRecalc(userId, actorId, reason)
  await logAudit({ actorId, action: "ANNUAL_GRANT_RECALC", targetType: "User", targetId: userId, payload: { reason, changes } })
  revalidateAll()
  return { success: true as const, message: `已重算 ${changes.length} 筆` }
}

export async function listUserGrantsAction(userId: string) {
  await requireAdmin()
  return prisma.annualLeaveGrant.findMany({
    where: { userId },
    orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, kind: true, year: true, effectiveAt: true, amount: true, basis: true, reason: true, source: true,
      createdAt: true, voidedAt: true, voidReason: true,
      createdBy: { select: { name: true } }, voidedBy: { select: { name: true } },
    },
  })
}
