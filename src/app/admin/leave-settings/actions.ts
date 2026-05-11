"use server"

import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { revalidatePath } from "next/cache"

async function verifyAdmin() {
  const session = await auth()
  if (!session?.user?.email) throw new Error("Unauthorized")
  
  const user = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (user?.role !== "ADMIN") throw new Error("Forbidden")
}

export async function createLeaveType(data: FormData) {
  await verifyAdmin()
  const name = data.get("name") as string
  const defaultDays = Number(data.get("defaultDays"))
  const isPaid = data.get("isPaid") === "true"

  if (!name || isNaN(defaultDays)) throw new Error("Invalid input")

  await prisma.leaveType.create({
    data: { name, defaultDays, isPaid }
  })
  revalidatePath("/admin/leave-settings")
}

export async function deleteLeaveType(data: FormData) {
  await verifyAdmin()
  const id = data.get("id") as string
  if (!id) return

  // Need to delete related balances first
  await prisma.userLeaveBalance.deleteMany({ where: { leaveTypeId: id } })
  await prisma.leaveType.delete({ where: { id } })
  
  revalidatePath("/admin/leave-settings")
}

export async function updateUserTotalBalance(data: FormData) {
  await verifyAdmin()
  const userId = data.get("userId") as string
  const leaveTypeId = data.get("leaveTypeId") as string
  const totalQuota = Number(data.get("totalQuota"))
  const year = new Date().getFullYear()

  if (!userId || !leaveTypeId || isNaN(totalQuota)) throw new Error("Invalid input")

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

  revalidatePath("/admin/leave-settings")
}
