import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import {
  IMPERSONATE_ACTOR_COOKIE,
  IMPERSONATE_TARGET_COOKIE,
} from "@/lib/impersonation"

// POST /api/admin/impersonate/stop — 清掉 impersonate cookie，redirect 回 /admin/users
// 不需檢查 role：任何人都可以「停止 impersonate」（清自己 cookie 而已）
export async function POST(req: Request) {
  const c = await cookies()
  c.delete(IMPERSONATE_TARGET_COOKIE)
  c.delete(IMPERSONATE_ACTOR_COOKIE)
  return NextResponse.redirect(new URL("/admin/users", req.url), { status: 303 })
}
