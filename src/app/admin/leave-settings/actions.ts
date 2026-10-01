"use server"

import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { syncHolidaysForYear } from "@/lib/holiday-sync"
import { assertNotImpersonating } from "@/lib/impersonation"

async function verifyAdmin(): Promise<string> {
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user?.email) throw new Error("Unauthorized")

  const user = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (user?.role !== "ADMIN") throw new Error("Forbidden")
  return user.id
}

export async function createLeaveType(data: FormData) {
  const actorId = await verifyAdmin()
  const name = data.get("name") as string
  const defaultDays = Number(data.get("defaultDays"))
  const isPaid = data.get("isPaid") === "true"
  // 是否要求上傳證明文件（如婚假 / 喪假）；新增時即可勾選，後續也能用 toggle 改
  const requireProof = data.get("requireProof") === "true"

  if (!name || isNaN(defaultDays)) throw new Error("Invalid input")

  // 刪除假別是 soft delete（isActive=false），但 name 是 DB 層 @unique：
  // 列表看不到那筆，直接 create 同名卻會撞 P2002。先查含已刪除的同名假別。
  const existing = await prisma.leaveType.findUnique({ where: { name } })

  if (existing?.isActive) {
    return { success: false, message: `假別「${name}」已存在，請直接修改或改用其他名稱` }
  }

  let created
  try {
    created = existing
      // 同名但已被軟刪除 → 復活並套用這次填的設定（等同「刪掉重建」的預期行為）
      ? await prisma.leaveType.update({
          where: { id: existing.id },
          data: { defaultDays, isPaid, requireProof, isActive: true },
        })
      : await prisma.leaveType.create({
          data: { name, defaultDays, isPaid, requireProof, isActive: true },
        })
  } catch (error: any) {
    // 併發下仍可能撞 unique（兩人同時新增同名）
    if (error.code === 'P2002') {
      return { success: false, message: `假別「${name}」已存在，請重新整理後再試` }
    }
    throw error
  }

  await logAudit({
    actorId,
    action: "LEAVE_TYPE_CREATE",
    targetType: "LeaveType",
    targetId: created.id,
    payload: { name, defaultDays, isPaid, requireProof, revived: Boolean(existing) },
  })
  revalidatePath("/admin/leave-settings")
  return { success: true, message: existing ? "已重新啟用假別" : "已新增假別" }
}

// 切換某假別的「需要證明文件」開關；前端使用 optimistic toggle 即時反應
export async function toggleLeaveTypeRequireProof(data: FormData) {
  const actorId = await verifyAdmin()
  const id = data.get("id") as string
  const next = data.get("requireProof") === "true"
  if (!id) throw new Error("Invalid input")

  const before = await prisma.leaveType.findUnique({
    where: { id },
    select: { name: true, requireProof: true },
  })
  if (!before) throw new Error("LeaveType not found")

  await prisma.leaveType.update({
    where: { id },
    data: { requireProof: next },
  })

  await logAudit({
    actorId,
    action: "LEAVE_TYPE_UPDATE",
    targetType: "LeaveType",
    targetId: id,
    payload: { field: "requireProof", before: before.requireProof, after: next, name: before.name },
  })

  revalidatePath("/admin/leave-settings")
  return { success: true, message: next ? "已開啟「需要證明文件」" : "已關閉「需要證明文件」" }
}

export async function deleteLeaveType(data: FormData) {
  const actorId = await verifyAdmin()
  const id = data.get("id") as string
  if (!id) return

  // Soft delete instead of hard delete
  await prisma.leaveType.update({
    where: { id },
    data: { isActive: false }
  })
  await logAudit({
    actorId,
    action: "LEAVE_TYPE_DELETE",
    targetType: "LeaveType",
    targetId: id,
  })

  revalidatePath("/admin/leave-settings")
  return { success: true, message: "已刪除假別" }
}

export async function updateUserTotalBalance(data: FormData) {
  const actorId = await verifyAdmin()
  const userId = data.get("userId") as string
  const leaveTypeId = data.get("leaveTypeId") as string
  const totalQuota = Number(data.get("totalQuota"))
  const year = new Date().getFullYear()

  if (!userId || !leaveTypeId || isNaN(totalQuota)) throw new Error("Invalid input")

  const before = await prisma.userLeaveBalance.findUnique({
    where: { userId_leaveTypeId_year: { userId, leaveTypeId, year } },
    select: { totalQuota: true },
  })

  await prisma.userLeaveBalance.upsert({
    where: {
      userId_leaveTypeId_year: {
        userId,
        leaveTypeId,
        year
      }
    },
    update: { totalQuota },
    create: { userId, leaveTypeId, year, totalQuota }
  })

  await logAudit({
    actorId,
    action: "BALANCE_UPDATE",
    targetType: "UserLeaveBalance",
    targetId: `${userId}:${leaveTypeId}:${year}`,
    payload: { userId, leaveTypeId, year, from: before?.totalQuota ?? null, to: totalQuota },
  })

  revalidatePath("/admin/leave-settings")
  return { success: true, message: "已更新額度" }
}

// 刪除該員工該假別的「所有」override row，讓員工回到「純基準」（特休回到公司前 2 年 / 政府表 fallback）
export async function deleteUserLeaveBalance(data: FormData) {
  const actorId = await verifyAdmin()
  const userId = data.get("userId") as string
  const leaveTypeId = data.get("leaveTypeId") as string

  if (!userId || !leaveTypeId) throw new Error("Invalid input")

  // 刪除所有歷年的 override row（分水嶺式設計下，留任何一筆都還會被沿用）
  const result = await prisma.userLeaveBalance.deleteMany({
    where: { userId, leaveTypeId },
  })

  await logAudit({
    actorId,
    action: "BALANCE_UPDATE",
    targetType: "UserLeaveBalance",
    targetId: `${userId}:${leaveTypeId}`,
    payload: { userId, leaveTypeId, deletedCount: result.count, action: "DELETE_ALL_OVERRIDES" },
  })

  revalidatePath("/admin/leave-settings")
  return { success: true, message: `已移除 override，共刪除 ${result.count} 筆歷年設定` }
}

// ── HR 手動調整特休（曆年制：補發 / 扣除）──
// effectiveAt 之前 balance 不含此調整；員工從 effectiveAt 當天起可動用

export async function syncHolidays(year: number) {
  const actorId = await verifyAdmin()
  const r = await syncHolidaysForYear(year)
  if (r.status === "not_published") {
    throw new Error(`${year} 年的國定假日資料尚未公布`)
  }
  await logAudit({
    actorId,
    action: "HOLIDAY_SYNC",
    targetType: "Holiday",
    targetId: String(year),
    payload: { year, upserted: r.upserted, removed: r.removed },
  })
  revalidatePath("/admin/leave-settings")
  revalidatePath("/apply")
  return { success: true, message: `已成功同步 ${year} 年共 ${r.upserted} 筆國定假日/補班日${r.removed ? `（移除 ${r.removed} 筆來源已取消的日期）` : ""}` }
}
