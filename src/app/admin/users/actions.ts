"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { Role } from "@prisma/client"

export async function updateUserRole(userId: string, role: Role) {
  await prisma.user.update({
    where: { id: userId },
    data: { role },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已更新角色權限" }
}

export async function updateUserManager(userId: string, managerId: string | null) {
  // Prevent setting self as manager
  if (userId === managerId) throw new Error("不能設定自己為主管");

  await prisma.user.update({
    where: { id: userId },
    data: { managerId },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已更新直屬主管" }
}

export async function updateUserHireDate(userId: string, hireDate: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { hireDate: hireDate ? new Date(hireDate) : null },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已更新到職日" }
}

export async function updateUserGender(userId: string, gender: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { gender: gender as any },
  })
  revalidatePath("/admin/users")
  return { success: true, message: "已更新性別" }
}

export async function updateUserTerminatedDate(userId: string, terminatedDate: string) {
  // 清空 = 復職
  if (!terminatedDate) {
    await prisma.user.update({
      where: { id: userId },
      data: { terminatedDate: null },
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
  revalidatePath("/admin/users")
  return { success: true, message: "已標記離職" }
}

export async function createUser(data: FormData) {
  const name = data.get("name") as string
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

  await prisma.user.create({
    data: {
      name,
      email,
      department: department || null,
      role: role || "EMPLOYEE",
      hireDate: hireDateStr ? new Date(hireDateStr) : null,
      gender: gender || "FEMALE"
    }
  })

  revalidatePath("/admin/users")
}
