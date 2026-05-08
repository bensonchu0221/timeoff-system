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
}

export async function updateUserManager(userId: string, managerId: string | null) {
  // Prevent setting self as manager
  if (userId === managerId) return;

  await prisma.user.update({
    where: { id: userId },
    data: { managerId },
  })
  revalidatePath("/admin/users")
}
