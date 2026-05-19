import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  IMPERSONATE_ACTOR_COOKIE,
  IMPERSONATE_TARGET_COOKIE,
} from "@/lib/impersonation"

// 同上：Cloud Run req.url 是內部 URL，redirect 要用對外公開 URL
function publicOrigin(req: Request): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL.replace(/\/$/, "")
  const proto = req.headers.get("x-forwarded-proto") ?? "http"
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:8080"
  return `${proto}://${host}`
}

// POST /api/admin/impersonate/stop — 清掉 impersonate cookie，redirect 回 /admin/users
// 不需檢查 role：任何人都可以「停止 impersonate」（清自己 cookie 而已）
export async function POST(req: Request) {
  const c = await cookies()
  c.delete(IMPERSONATE_TARGET_COOKIE)
  c.delete(IMPERSONATE_ACTOR_COOKIE)
  return NextResponse.redirect(new URL("/admin/users", publicOrigin(req)), { status: 303 })
}
