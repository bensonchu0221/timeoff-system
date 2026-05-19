import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import {
  IMPERSONATE_ACTOR_COOKIE,
  IMPERSONATE_COOKIE_OPTS,
  IMPERSONATE_TARGET_COOKIE,
} from "@/lib/impersonation"

// POST /api/admin/impersonate?email=connie@popin.cc
//   或 ?userId=xxx
// 設 cookie，redirect 到 /；只有實際登入身分為 ADMIN 才可使用
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // 直接從 DB 確認真實 role（避免被 impersonate cookie 偽裝）
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  })
  if (me?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = new URL(req.url)
  const email = url.searchParams.get("email")?.trim().toLowerCase()
  const userId = url.searchParams.get("userId")?.trim()

  if (!email && !userId) {
    return NextResponse.json({ error: "Missing email or userId" }, { status: 400 })
  }

  const target = await prisma.user.findUnique({
    where: userId ? { id: userId } : { email: email! },
    select: { id: true, email: true, name: true },
  })
  if (!target) {
    return NextResponse.json({ error: "Target user not found" }, { status: 404 })
  }

  // 不允許 impersonate 自己（沒意義也避免迷惑）
  if (target.id === me.id) {
    return NextResponse.json({ error: "Cannot impersonate yourself" }, { status: 400 })
  }

  const c = await cookies()
  c.set(IMPERSONATE_TARGET_COOKIE, target.id, IMPERSONATE_COOKIE_OPTS)
  c.set(IMPERSONATE_ACTOR_COOKIE, me.id, IMPERSONATE_COOKIE_OPTS)

  return NextResponse.redirect(new URL("/", req.url), { status: 303 })
}
