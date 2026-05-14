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

export async function forceSetAllHireDates() {
  const result = await prisma.user.updateMany({
    data: { hireDate: new Date('2026-01-01T00:00:00Z') }
  })
  revalidatePath("/admin/users")
  return { success: true, message: `已將 ${result.count} 位使用者的到職日設為 2026/01/01` }
}

export async function createUser(data: FormData) {
  const name = data.get("name") as string
  const email = data.get("email") as string
  const department = data.get("department") as string
  const role = data.get("role") as Role
  const hireDateStr = data.get("hireDate") as string

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
    }
  })

  revalidatePath("/admin/users")
}
