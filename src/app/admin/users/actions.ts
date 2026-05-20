"use server"

import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { Role } from "@prisma/client"
import { assertNotImpersonating } from "@/lib/impersonation"

async function requireActorId(): Promise<string> {
  // impersonate 模式下 session.user.id 會被替換成 target，這裡直接擋以避免任何 admin 寫入流到目標員工身上
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  return session.user.id
}

export async function updateUserRole(userId: string, role: Role) {
  const actorId = await requireActorId()
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  await prisma.user.update({
    where: { id: userId },
    data: { role },
  })
  await logAudit({
    actorId,
    action: "USER_UPDATE_ROLE",
    targetType: "User",
    targetId: userId,
    payload: { from: before?.role, to: role },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已更新角色權限" }
}

export async function updateUserManager(userId: string, managerId: string | null) {
  const actorId = await requireActorId()
  if (userId === managerId) throw new Error("不能設定自己為主管");

  const before = await prisma.user.findUnique({ where: { id: userId }, select: { managerId: true } })
  await prisma.user.update({
    where: { id: userId },
    data: { managerId },
  })
  await logAudit({
    actorId,
    action: "USER_UPDATE_MANAGER",
    targetType: "User",
    targetId: userId,
    payload: { from: before?.managerId, to: managerId },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已更新直屬主管" }
}

export async function updateUserHireDate(userId: string, hireDate: string) {
  const actorId = await requireActorId()
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { hireDate: true } })
  await prisma.user.update({
    where: { id: userId },
    data: { hireDate: hireDate ? new Date(hireDate) : null },
  })
  await logAudit({
    actorId,
    action: "USER_UPDATE_HIREDATE",
    targetType: "User",
    targetId: userId,
    payload: { from: before?.hireDate?.toISOString() || null, to: hireDate || null },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已更新到職日" }
}

export async function updateUserGender(userId: string, gender: string) {
  const actorId = await requireActorId()
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { gender: true } })
  await prisma.user.update({
    where: { id: userId },
    data: { gender: gender as any },
  })
  await logAudit({
    actorId,
    action: "USER_UPDATE_GENDER",
    targetType: "User",
    targetId: userId,
    payload: { from: before?.gender, to: gender },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已更新性別" }
}

export async function updateUserTerminatedDate(userId: string, terminatedDate: string) {
  const actorId = await requireActorId()
  // 清空 = 復職
  if (!terminatedDate) {
    await prisma.user.update({
      where: { id: userId },
      data: { terminatedDate: null },
    })
    await logAudit({
      actorId,
      action: "USER_REACTIVATE",
      targetType: "User",
      targetId: userId,
    })
    revalidatePath("/admin/users")
    return { success: true, message: "已標記為在職" }
  }

  // 標記離職前，必須先把該員工底下的所有下屬重指派；否則下屬會卡死無法簽核
  const subordinates = await prisma.user.findMany({
    where: { managerId: userId, terminatedDate: null },
    select: { id: true, name: true, email: true },
  })
  if (subordinates.length > 0) {
    const names = subordinates.map((s) => s.name || s.email).join("、")
    throw new Error(
      `此員工底下還有 ${subordinates.length} 位在職下屬（${names}），請先將下屬的直屬主管改派給其他人再標記離職。`
    )
  }

  await prisma.user.update({
    where: { id: userId },
    data: { terminatedDate: new Date(terminatedDate) },
  })
  await logAudit({
    actorId,
    action: "USER_TERMINATE",
    targetType: "User",
    targetId: userId,
    payload: { terminatedDate },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已標記離職" }
}

export async function createUser(data: FormData) {
  const actorId = await requireActorId()
  const name = data.get("name") as string
  const chineseName = data.get("chineseName") as string
  const email = data.get("email") as string
  const department = data.get("department") as string
  const role = data.get("role") as Role
  const hireDateStr = data.get("hireDate") as string
  const gender = data.get("gender") as any

  if (!name || !email) {
    throw new Error("姓名與 Email 為必填欄位")
  }

  // Check if email already exists
  const existingUser = await prisma.user.findUnique({
    where: { email }
  })
  if (existingUser) {
    throw new Error("此 Email 已經存在！")
  }

  const created = await prisma.user.create({
    data: {
      name,
      chineseName: chineseName || null,
      email,
      department: department || null,
      role: role || "EMPLOYEE",
      hireDate: hireDateStr ? new Date(hireDateStr) : null,
      gender: gender || "FEMALE"
    }
  })

  await logAudit({
    actorId,
    action: "USER_CREATE",
    targetType: "User",
    targetId: created.id,
    payload: { name, chineseName: chineseName || null, email, role: role || "EMPLOYEE", hireDate: hireDateStr || null },
  })

  revalidatePath("/admin/users")
}

// 更新中文姓名
export async function updateUserChineseName(userId: string, chineseName: string) {
  const actorId = await requireActorId()
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { chineseName: true } })
  const value = chineseName.trim() || null
  await prisma.user.update({ where: { id: userId }, data: { chineseName: value } })
  await logAudit({
    actorId,
    action: "USER_UPDATE_CHINESE_NAME",
    targetType: "User",
    targetId: userId,
    payload: { from: before?.chineseName ?? null, to: value },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已更新中文姓名" }
}

// 更新部門
export async function updateUserDepartment(userId: string, department: string) {
  const actorId = await requireActorId()
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { department: true } })
  const value = department.trim() || null
  await prisma.user.update({ where: { id: userId }, data: { department: value } })
  await logAudit({
    actorId,
    action: "USER_UPDATE_DEPARTMENT",
    targetType: "User",
    targetId: userId,
    payload: { from: before?.department ?? null, to: value },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已更新部門" }
}

// 設定特休 Opening Balance（四欄一起寫入：balance、at、B、R）
// B/R 為算式分量：opening = round((hireDate月份/12) × B + R, 0.5)
// 不強制驗證 round 結果是否等於 balance，因為 HR 可能手動微調（rounding 邊界保留彈性）
export async function setAnnualLeaveOpening(
  userId: string,
  balance: number,
  atISO: string,
  b: number | null,
  r: number | null,
) {
  const actorId = await requireActorId()
  if (isNaN(balance) || balance < 0) throw new Error("Opening 天數需為非負數")
  if (!atISO) throw new Error("Opening 日期必填")

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      annualLeaveOpeningBalance: true,
      annualLeaveOpeningAt: true,
      annualLeaveOpeningB: true,
      annualLeaveOpeningR: true,
    },
  })
  await prisma.user.update({
    where: { id: userId },
    data: {
      annualLeaveOpeningBalance: balance,
      annualLeaveOpeningAt: new Date(`${atISO}T00:00:00.000Z`),
      annualLeaveOpeningB: b,
      annualLeaveOpeningR: r,
    },
  })
  await logAudit({
    actorId,
    action: "USER_SET_ANNUAL_OPENING",
    targetType: "User",
    targetId: userId,
    payload: {
      from: {
        balance: before?.annualLeaveOpeningBalance ?? null,
        at: before?.annualLeaveOpeningAt?.toISOString() ?? null,
        b: before?.annualLeaveOpeningB ?? null,
        r: before?.annualLeaveOpeningR ?? null,
      },
      to: { balance, at: atISO, b, r },
    },
  })
  revalidatePath("/admin/users")
  revalidatePath("/")
  return { success: true, message: `已設定特休 Opening = ${balance} 天 @ ${atISO}` }
}

// 清除特休 Opening（四欄一起 null）
export async function clearAnnualLeaveOpening(userId: string) {
  const actorId = await requireActorId()
  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      annualLeaveOpeningBalance: true,
      annualLeaveOpeningAt: true,
      annualLeaveOpeningB: true,
      annualLeaveOpeningR: true,
    },
  })
  await prisma.user.update({
    where: { id: userId },
    data: {
      annualLeaveOpeningBalance: null,
      annualLeaveOpeningAt: null,
      annualLeaveOpeningB: null,
      annualLeaveOpeningR: null,
    },
  })
  await logAudit({
    actorId,
    action: "USER_CLEAR_ANNUAL_OPENING",
    targetType: "User",
    targetId: userId,
    payload: {
      cleared: {
        balance: before?.annualLeaveOpeningBalance ?? null,
        at: before?.annualLeaveOpeningAt?.toISOString() ?? null,
        b: before?.annualLeaveOpeningB ?? null,
        r: before?.annualLeaveOpeningR ?? null,
      },
    },
  })
  revalidatePath("/admin/users")
  revalidatePath("/")
  return { success: true, message: "已清除特休 Opening" }
}
