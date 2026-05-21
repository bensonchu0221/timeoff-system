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

// 統一 revalidate：部門表會影響員工管理頁與請假頁的下拉、首頁/甘特圖排序
function revalidateAll() {
  revalidatePath("/admin/departments")
  revalidatePath("/admin/users")
  revalidatePath("/admin/approvals")
  revalidatePath("/apply")
  revalidatePath("/gantt")
  revalidatePath("/")
}

function mapUniqueError(error: any): never {
  if (error?.code === "P2002") {
    const target = (error.meta?.target as string[] | undefined)?.join(",") ?? ""
    if (target.includes("name")) throw new Error("此部門名稱已存在")
    if (target.includes("code")) throw new Error("此部門代碼已存在")
    throw new Error("欄位重複")
  }
  throw error
}

export async function createDepartment(data: FormData) {
  const actorId = await verifyAdmin()
  const name = ((data.get("name") as string) || "").trim()
  const codeRaw = ((data.get("code") as string) || "").trim()
  const sortOrderStr = (data.get("sortOrder") as string) || "0"

  if (!name) throw new Error("部門名稱為必填")
  const sortOrder = Number(sortOrderStr)
  if (isNaN(sortOrder)) throw new Error("排序需為數字")

  let created
  try {
    created = await prisma.department.create({
      data: {
        name,
        code: codeRaw || null,
        sortOrder,
        isActive: true,
      },
    })
  } catch (error: any) {
    mapUniqueError(error)
  }

  await logAudit({
    actorId,
    action: "DEPARTMENT_CREATE",
    targetType: "Department",
    targetId: created!.id,
    payload: { name, code: codeRaw || null, sortOrder },
  })
  revalidateAll()
  return { success: true, message: "已新增部門" }
}

export async function updateDepartmentName(id: string, name: string) {
  const actorId = await verifyAdmin()
  const value = name.trim()
  if (!value) throw new Error("部門名稱不可為空")

  const before = await prisma.department.findUnique({
    where: { id },
    select: { name: true },
  })
  try {
    await prisma.department.update({ where: { id }, data: { name: value } })
  } catch (error: any) {
    mapUniqueError(error)
  }
  await logAudit({
    actorId,
    action: "DEPARTMENT_UPDATE_NAME",
    targetType: "Department",
    targetId: id,
    payload: { from: before?.name ?? null, to: value },
  })
  revalidateAll()
  return { success: true, message: "已更新部門名稱" }
}

export async function updateDepartmentCode(id: string, code: string) {
  const actorId = await verifyAdmin()
  const value = code.trim() || null

  const before = await prisma.department.findUnique({
    where: { id },
    select: { code: true },
  })
  try {
    await prisma.department.update({ where: { id }, data: { code: value } })
  } catch (error: any) {
    mapUniqueError(error)
  }
  await logAudit({
    actorId,
    action: "DEPARTMENT_UPDATE_CODE",
    targetType: "Department",
    targetId: id,
    payload: { from: before?.code ?? null, to: value },
  })
  revalidateAll()
  return { success: true, message: "已更新代碼" }
}

export async function updateDepartmentSortOrder(id: string, sortOrder: number) {
  const actorId = await verifyAdmin()
  if (isNaN(sortOrder)) throw new Error("排序需為數字")

  const before = await prisma.department.findUnique({
    where: { id },
    select: { sortOrder: true },
  })
  await prisma.department.update({ where: { id }, data: { sortOrder } })
  await logAudit({
    actorId,
    action: "DEPARTMENT_UPDATE_SORT",
    targetType: "Department",
    targetId: id,
    payload: { from: before?.sortOrder ?? null, to: sortOrder },
  })
  revalidateAll()
  return { success: true, message: "已更新排序" }
}

export async function toggleDepartmentActive(id: string, isActive: boolean) {
  const actorId = await verifyAdmin()

  // 停用時若仍有使用者掛在此部門，阻擋（避免新建表單以為已停用但既有 user 還引用）
  if (!isActive) {
    const userCount = await prisma.user.count({ where: { departmentId: id } })
    if (userCount > 0) {
      throw new Error(`此部門仍有 ${userCount} 位使用者，請先將他們轉到其他部門再停用`)
    }
  }

  await prisma.department.update({ where: { id }, data: { isActive } })
  await logAudit({
    actorId,
    action: "DEPARTMENT_TOGGLE_ACTIVE",
    targetType: "Department",
    targetId: id,
    payload: { to: isActive },
  })
  revalidateAll()
  return { success: true, message: isActive ? "已啟用" : "已停用" }
}
