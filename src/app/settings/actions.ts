"use server"

import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { generateBindingCode, LineNotifyKey } from "@/lib/line"
import { revalidatePath } from "next/cache"
import { assertNotImpersonating } from "@/lib/impersonation"

const BINDING_CODE_TTL_MS = 30 * 60 * 1000 // 30 分鐘

/**
 * 產 6 碼綁定碼（30 分鐘有效）。
 * 重複呼叫會覆寫舊碼，避免一個員工同時有多個有效碼。
 */
export async function generateLineBindingCode() {
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  // 若已綁定，拒絕產碼（要先解綁）
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { lineUserId: true },
  })
  if (me?.lineUserId) {
    throw new Error("您已綁定 LINE，請先解綁再重新綁定。")
  }

  // 保證唯一：偶爾撞碼就重試（極低機率，6 碼 ≈ 10 億組合）
  let code = generateBindingCode()
  for (let i = 0; i < 5; i++) {
    const dup = await prisma.user.findUnique({ where: { lineBindingCode: code } })
    if (!dup || dup.id === session.user.id) break
    code = generateBindingCode()
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      lineBindingCode: code,
      lineBindingExpiry: new Date(Date.now() + BINDING_CODE_TTL_MS),
    },
  })

  revalidatePath("/settings")
  return { code }
}

/**
 * 解綁：清掉 lineUserId / lineBoundAt / 還在的綁定碼
 */
export async function unbindLine() {
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      lineUserId: null,
      lineBoundAt: null,
      lineBindingCode: null,
      lineBindingExpiry: null,
    },
  })

  revalidatePath("/settings")
  return { success: true }
}

/**
 * 更新單一通知偏好 key
 */
export async function updateLineNotifyPref(key: LineNotifyKey, enabled: boolean) {
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { lineNotifyPrefs: true },
  })

  const prefs = (me?.lineNotifyPrefs as Record<string, boolean>) || {}
  prefs[key] = enabled

  await prisma.user.update({
    where: { id: session.user.id },
    data: { lineNotifyPrefs: prefs },
  })

  revalidatePath("/settings")
  return { success: true }
}
