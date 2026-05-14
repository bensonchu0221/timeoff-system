"use server"

import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { auth } from "@/auth"

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
  const session = await auth()
  if (!session?.user || (session.user as any).role !== "ADMIN") throw new Error("Unauthorized")

  await prisma.fAQ.create({ data })
  revalidatePath("/")
  revalidatePath("/admin/qa")
}

export async function updateFAQ(id: string, data: { question?: string, answer?: string, category?: string, order?: number }) {
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
  const session = await auth()
  if (!session?.user || (session.user as any).role !== "ADMIN") throw new Error("Unauthorized")

  await prisma.fAQ.delete({ where: { id } })
  revalidatePath("/")
  revalidatePath("/admin/qa")
}
