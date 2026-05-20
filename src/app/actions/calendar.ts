"use server"

import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { logAudit } from "@/lib/audit"
import crypto from "crypto"
import { assertNotImpersonating } from "@/lib/impersonation"

// 32 字元 url-safe token；衝撞機率極低，重設時直接覆蓋舊值即可撤銷舊訂閱
function generateToken(): string {
  return crypto.randomBytes(24).toString("base64url")
}

async function ensureToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { calendarToken: true } })
  if (user?.calendarToken) return user.calendarToken
  const token = generateToken()
  await prisma.user.update({ where: { id: userId }, data: { calendarToken: token } })
  return token
}

function siteUrl(): string {
  return process.env.NEXTAUTH_URL || "http://localhost:8080"
}

// 個人訂閱網址：本人請假事件
export async function getMyCalendarUrl() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  const token = await ensureToken(session.user.id)
  return { url: `${siteUrl()}/api/calendar/${session.user.id}.ics?token=${token}` }
}

// 團隊訂閱網址：自己所在的小組（主管 + 同組成員），全員可取得
export async function getTeamCalendarUrl() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  const token = await ensureToken(session.user.id)
  return { url: `${siteUrl()}/api/calendar/team/${session.user.id}.ics?token=${token}` }
}

// 全公司訂閱網址：所有人的已核准假單，全員可取得
export async function getCompanyCalendarUrl() {
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  const token = await ensureToken(session.user.id)
  return { url: `${siteUrl()}/api/calendar/company/${session.user.id}.ics?token=${token}` }
}

// 重設 token → 舊網址即刻失效
export async function resetCalendarToken(targetUserId?: string) {
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")

  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id } })
  const targetId = targetUserId || session.user.id

  // 重設別人的 token 需要 ADMIN
  if (targetId !== session.user.id && dbUser?.role !== "ADMIN") {
    throw new Error("Forbidden")
  }

  const token = generateToken()
  await prisma.user.update({ where: { id: targetId }, data: { calendarToken: token } })

  await logAudit({
    actorId: session.user.id,
    action: "USER_RESET_CALENDAR_TOKEN",
    targetType: "User",
    targetId,
  })

  return { success: true }
}
