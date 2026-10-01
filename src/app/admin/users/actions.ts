"use server"

import { prisma } from "@/lib/db"
import { logAudit } from "@/lib/audit"
import { requireAdmin } from "@/lib/admin-guard"
import { grantOnHire, previewHireDateRecalc, voidGrantsAfterTermination, setOpening } from "@/lib/annual-grant"
import { revalidatePath } from "next/cache"
import { Role, Company } from "@prisma/client"

// 到職日防呆：必須是 YYYY-MM-DD 的真實日期，年份 1980 ~ 明年。
// （輸入框打到一半的日期如 0002-01-15 會觸發新人發放，必須擋下）
function parseHireDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const date = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null
  const maxYear = new Date().getUTCFullYear() + 1
  if (!m || !date || date.toISOString().slice(0, 10) !== value || Number(m[1]) < 1980 || Number(m[1]) > maxYear) {
    throw new Error(`到職日不合理：${value}`)
  }
  return date
}

export async function updateUserRole(userId: string, role: Role) {
  const actorId = await requireAdmin()
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

export async function updateUserCompany(userId: string, company: Company) {
  const actorId = await requireAdmin()
  if (!["POPIN", "BROADCIEL"].includes(company)) throw new Error("無效的公司代號")
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { company: true } })
  await prisma.user.update({
    where: { id: userId },
    data: { company },
  })
  await logAudit({
    actorId,
    action: "USER_UPDATE_COMPANY",
    targetType: "User",
    targetId: userId,
    payload: { from: before?.company ?? null, to: company },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已更新所屬公司" }
}

export async function updateUserManager(userId: string, managerId: string | null) {
  const actorId = await requireAdmin()
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

// 兩階段審核：設定 / 取消「終審者」（Boss）。全公司唯一一人，設定時會清掉其他人的旗標。
export async function setFinalApprover(userId: string, isFinalApprover: boolean) {
  const actorId = await requireAdmin()

  if (isFinalApprover) {
    // 保證唯一：先把其他人的旗標清掉，再設這位
    await prisma.$transaction([
      prisma.user.updateMany({ where: { isFinalApprover: true, NOT: { id: userId } }, data: { isFinalApprover: false } }),
      prisma.user.update({ where: { id: userId }, data: { isFinalApprover: true } }),
    ])
  } else {
    await prisma.user.update({ where: { id: userId }, data: { isFinalApprover: false } })
  }

  await logAudit({
    actorId,
    action: "USER_SET_FINAL_APPROVER",
    targetType: "User",
    targetId: userId,
    payload: { isFinalApprover },
  })
  revalidatePath("/admin/users")
  return { success: true, message: isFinalApprover ? "已設為終審者（Boss）" : "已取消終審者" }
}

export async function updateUserHireDate(userId: string, hireDate: string) {
  const actorId = await requireAdmin()
  const parsedHireDate = hireDate ? parseHireDate(hireDate) : null
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { hireDate: true } })
  await prisma.user.update({
    where: { id: userId },
    data: { hireDate: parsedHireDate },
  })
  await logAudit({
    actorId,
    action: "USER_UPDATE_HIREDATE",
    targetType: "User",
    targetId: userId,
    payload: { from: before?.hireDate?.toISOString() || null, to: hireDate || null },
  })
  // 原本沒有到職日 → 視為新人建檔，直接發放；原本有 → 回傳重算預覽讓 HR 決定
  let recalc: Awaited<ReturnType<typeof previewHireDateRecalc>> = []
  if (hireDate && !before?.hireDate) {
    await grantOnHire(userId, { actorId })
  } else if (hireDate) {
    recalc = await previewHireDateRecalc(userId)
  }
  revalidatePath("/admin/users")
  return { success: true, message: "已更新到職日", recalc }
}

export async function updateUserGender(userId: string, gender: string) {
  const actorId = await requireAdmin()
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
  const actorId = await requireAdmin()
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
  const voided = await voidGrantsAfterTermination(userId, new Date(terminatedDate), actorId)
  await logAudit({
    actorId,
    action: "USER_TERMINATE",
    targetType: "User",
    targetId: userId,
    payload: { terminatedDate },
  })
  revalidatePath("/admin/users")
  const voidedMsg = voided.length ? `；已作廢 ${voided.map((v) => `${v.year ?? ""} ${v.kind === "ANNUAL" ? "年度" : "首年"}特休 ${v.amount} 天`).join("、")}` : ""
  return { success: true, message: `已標記離職${voidedMsg}`, voided }
}

export async function createUser(data: FormData) {
  const actorId = await requireAdmin()
  const name = data.get("name") as string
  const chineseName = data.get("chineseName") as string
  const email = data.get("email") as string
  const departmentId = data.get("departmentId") as string
  const role = data.get("role") as Role
  const hireDateStr = data.get("hireDate") as string
  const gender = data.get("gender") as any
  const company = data.get("company") as Company

  if (!name || !email) {
    throw new Error("姓名與 Email 為必填欄位")
  }
  if (!departmentId) {
    throw new Error("部門為必填欄位")
  }
  if (!company || !["POPIN", "BROADCIEL"].includes(company)) {
    throw new Error("所屬公司為必填欄位")
  }

  // 驗證部門存在且啟用（避免前端傳入失效 id）
  const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { isActive: true } })
  if (!dept) throw new Error("找不到此部門")
  if (!dept.isActive) throw new Error("此部門已停用，無法指派")

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
      departmentId,
      role: role || "EMPLOYEE",
      hireDate: hireDateStr ? parseHireDate(hireDateStr) : null,
      gender: gender || "FEMALE",
      company,
    }
  })

  await logAudit({
    actorId,
    action: "USER_CREATE",
    targetType: "User",
    targetId: created.id,
    payload: { name, chineseName: chineseName || null, email, departmentId, role: role || "EMPLOYEE", hireDate: hireDateStr || null, company },
  })

  if (hireDateStr) await grantOnHire(created.id, { actorId })

  revalidatePath("/admin/users")
}

// 更新中文姓名
export async function updateUserChineseName(userId: string, chineseName: string) {
  const actorId = await requireAdmin()
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

// 更新部門：傳入 Department.id；驗證存在且啟用後更新
export async function updateUserDepartment(userId: string, departmentId: string) {
  const actorId = await requireAdmin()
  if (!departmentId) throw new Error("請選擇部門")

  const dept = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { isActive: true, name: true },
  })
  if (!dept) throw new Error("找不到此部門")
  if (!dept.isActive) throw new Error("此部門已停用，無法指派")

  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true },
  })
  await prisma.user.update({ where: { id: userId }, data: { departmentId } })
  await logAudit({
    actorId,
    action: "USER_UPDATE_DEPARTMENT",
    targetType: "User",
    targetId: userId,
    payload: { from: before?.departmentId ?? null, to: departmentId },
  })
  revalidatePath("/admin/users")
  return { success: true, message: `已更新部門為 ${dept.name}` }
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
  const actorId = await requireAdmin()
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
  // 新制：寫入 OPENING 發放紀錄（舊欄位照寫，保留到遷移穩定後移除，方便退回舊版）
  await setOpening({ userId, balance, at: new Date(`${atISO}T00:00:00.000Z`), actorId })
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
  const actorId = await requireAdmin()
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
  await prisma.annualLeaveGrant.updateMany({
    where: { userId, kind: "OPENING", voidedAt: null },
    data: { voidedAt: new Date(), voidedById: actorId, voidReason: "HR 清除期初餘額" },
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
  // 期初清掉後，該員工的首年與各年度發放需要補回（舊制會自動從到職日重算）→ 回傳預覽讓 HR 確認
  const recalc = await previewHireDateRecalc(userId)
  return { success: true, message: "已清除特休期初", recalc }
}
