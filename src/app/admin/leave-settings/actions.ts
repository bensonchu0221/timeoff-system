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

  try {
    await prisma.leaveType.create({
      data: { name, defaultDays, isPaid, isActive: true }
    })
  } catch (error: any) {
    if (error.code === 'P2002') {
      throw new Error("同樣假別異常，請聯絡系統管理員")
    }
    throw error
  }
  revalidatePath("/admin/leave-settings")
  return { success: true, message: "已新增假別" }
}

export async function deleteLeaveType(data: FormData) {
  await verifyAdmin()
  const id = data.get("id") as string
  if (!id) return

  // Soft delete instead of hard delete
  await prisma.leaveType.update({ 
    where: { id },
    data: { isActive: false }
  })
  
  revalidatePath("/admin/leave-settings")
  return { success: true, message: "已刪除假別" }
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
  return { success: true, message: "已更新額度" }
}

export async function syncHolidays(year: number) {
  await verifyAdmin()
  
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
    
    revalidatePath("/admin/leave-settings")
    revalidatePath("/apply")
    return { success: true, message: `已成功同步 ${year} 年共 ${addedCount} 筆國定假日/補班日` }
  } catch (error: any) {
    throw new Error(error.message || "同步假日失敗")
  }
}
