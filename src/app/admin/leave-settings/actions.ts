"use server"

import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
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

  let created
  try {
    created = await prisma.leaveType.create({
      data: { name, defaultDays, isPaid, requireProof, isActive: true }
    })
  } catch (error: any) {
    if (error.code === 'P2002') {
      throw new Error("同樣假別異常，請聯絡系統管理員")
    }
    throw error
  }
  await logAudit({
    actorId,
    action: "LEAVE_TYPE_CREATE",
    targetType: "LeaveType",
    targetId: created.id,
    payload: { name, defaultDays, isPaid, requireProof },
  })
  revalidatePath("/admin/leave-settings")
  return { success: true, message: "已新增假別" }
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

export async function addLeaveAdjustment(data: FormData) {
  const actorId = await verifyAdmin()
  const userId = data.get("userId") as string
  const leaveTypeId = data.get("leaveTypeId") as string
  const effectiveAtStr = data.get("effectiveAt") as string
  const amount = Number(data.get("amount"))
  const reason = ((data.get("reason") as string) || "").trim()

  if (!userId || !leaveTypeId || !effectiveAtStr) throw new Error("欄位不可空白")
  if (isNaN(amount) || amount === 0) throw new Error("數量必須為非 0 數值")
  // 限制 0.5 倍數
  if (Math.abs(amount * 2 - Math.round(amount * 2)) > 1e-9) {
    throw new Error("數量必須是 0.5 的倍數")
  }
  if (!reason) throw new Error("原因必填")

  // 正規化 effectiveAt 為 UTC midnight（與 hireDate / 1/1 grant 一致）
  const [y, m, d] = effectiveAtStr.split("-").map(Number)
  if (!y || !m || !d) throw new Error("生效日格式錯誤")
  const effectiveAt = new Date(Date.UTC(y, m - 1, d))

  const created = await prisma.leaveAdjustment.create({
    data: { userId, leaveTypeId, effectiveAt, amount, reason, createdById: actorId },
  })

  await logAudit({
    actorId,
    action: "USER_ADD_LEAVE_ADJUSTMENT",
    targetType: "LeaveAdjustment",
    targetId: created.id,
    payload: { userId, leaveTypeId, effectiveAt: effectiveAt.toISOString(), amount, reason },
  })

  revalidatePath("/admin/leave-settings")
  return { success: true, message: `已新增調整 ${amount > 0 ? "+" : ""}${amount} 天` }
}

export async function deleteLeaveAdjustment(data: FormData) {
  const actorId = await verifyAdmin()
  const id = data.get("id") as string
  if (!id) throw new Error("缺少 id")

  const before = await prisma.leaveAdjustment.findUnique({ where: { id } })
  if (!before) throw new Error("找不到此調整紀錄")

  await prisma.leaveAdjustment.delete({ where: { id } })

  await logAudit({
    actorId,
    action: "USER_DELETE_LEAVE_ADJUSTMENT",
    targetType: "LeaveAdjustment",
    targetId: id,
    payload: {
      userId: before.userId,
      leaveTypeId: before.leaveTypeId,
      effectiveAt: before.effectiveAt.toISOString(),
      amount: before.amount,
      reason: before.reason,
    },
  })

  revalidatePath("/admin/leave-settings")
  return { success: true, message: "已刪除調整" }
}

export async function syncHolidays(year: number) {
  const actorId = await verifyAdmin()

  try {
    const res = await fetch(`https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`)
    if (!res.ok) {
      throw new Error(`無法取得 ${year} 年的國定假日資料。`)
    }
    
    const data = await res.json()
    let addedCount = 0;
    
    for (const item of data) {
      const dateStr = `${item.date.slice(0, 4)}-${item.date.slice(4, 6)}-${item.date.slice(6, 8)}T00:00:00.000Z`
      const dateObj = new Date(dateStr)
      const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6

      if (item.isHoliday) {
        // 放假日 (包含國定假日或彈性放假)
        await prisma.holiday.upsert({
          where: { date: dateObj },
          update: { name: item.description || "國定假日", isWorkDay: false },
          create: { date: dateObj, name: item.description || "國定假日", isWorkDay: false }
        })
        addedCount++;
      } else {
        // 補班日 (非假日且為週末)
        if (isWeekend) {
          await prisma.holiday.upsert({
            where: { date: dateObj },
            update: { name: item.description || "補班日", isWorkDay: true },
            create: { date: dateObj, name: item.description || "補班日", isWorkDay: true }
          })
          addedCount++;
        }
      }
    }
    
    await logAudit({
      actorId,
      action: "HOLIDAY_SYNC",
      targetType: "Holiday",
      targetId: String(year),
      payload: { year, addedCount },
    })

    revalidatePath("/admin/leave-settings")
    revalidatePath("/apply")
    return { success: true, message: `已成功同步 ${year} 年共 ${addedCount} 筆國定假日/補班日` }
  } catch (error: any) {
    throw new Error(error.message || "同步假日失敗")
  }
}
