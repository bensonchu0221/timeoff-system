"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"
import { assertNotImpersonating } from "@/lib/impersonation"

export async function getFAQs(search?: string) {
  return await prisma.fAQ.findMany({
    where: search ? {
      OR: [
        { question: { contains: search } },
        { answer: { contains: search } }
      ]
    } : {},
    orderBy: { order: 'asc' }
  })
}

export async function createFAQ(data: { question: string, answer: string, category?: string, order?: number }) {
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user || (session.user as any).role !== "ADMIN") throw new Error("Unauthorized")

  await prisma.fAQ.create({ data })
  revalidatePath("/")
  revalidatePath("/admin/qa")
}

export async function updateFAQ(id: string, data: { question?: string, answer?: string, category?: string, order?: number }) {
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user || (session.user as any).role !== "ADMIN") throw new Error("Unauthorized")

  await prisma.fAQ.update({
    where: { id },
    data
  })
  revalidatePath("/")
  revalidatePath("/admin/qa")
}

export async function deleteFAQ(id: string) {
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user || (session.user as any).role !== "ADMIN") throw new Error("Unauthorized")

  await prisma.fAQ.delete({ where: { id } })
  revalidatePath("/")
  revalidatePath("/admin/qa")
}

// 批次重排：依傳入的 id 順序，把每筆 FAQ.order 重設為 0,1,2,...
export async function reorderFAQs(orderedIds: string[]) {
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user || (session.user as any).role !== "ADMIN") throw new Error("Unauthorized")

  await prisma.$transaction(
    orderedIds.map((id, idx) =>
      prisma.fAQ.update({ where: { id }, data: { order: idx } })
    )
  )
  revalidatePath("/")
  revalidatePath("/admin/qa")
}
