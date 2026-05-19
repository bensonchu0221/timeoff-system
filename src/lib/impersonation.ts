import { cookies } from "next/headers"

// Impersonation（admin 以其他員工視角檢視）使用的 cookie 名稱
// target：被檢視員工 id；actor：發起檢視的 admin id（用來偵測 admin 切換或被冒用）
export const IMPERSONATE_TARGET_COOKIE = "ti-imp-target"
export const IMPERSONATE_ACTOR_COOKIE = "ti-imp-actor"

// Cookie 設定：HttpOnly + SameSite=Lax；不設 maxAge → session cookie（關瀏覽器消失）
export const IMPERSONATE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
}

// 讀 cookie；不驗證有效性（驗證由 auth callback 做）
export async function readImpersonationCookies(): Promise<{
  targetUserId: string | null
  actorUserId: string | null
}> {
  const c = await cookies()
  return {
    targetUserId: c.get(IMPERSONATE_TARGET_COOKIE)?.value ?? null,
    actorUserId: c.get(IMPERSONATE_ACTOR_COOKIE)?.value ?? null,
  }
}

// 寫操作必呼叫；impersonate 模式下禁止任何寫入，避免 admin 不小心以他人身分留下資料
export async function assertNotImpersonating(): Promise<void> {
  const { targetUserId } = await readImpersonationCookies()
  if (targetUserId) {
    throw new Error("正在以他人視角檢視中，禁止寫入操作。請先停止 impersonate。")
  }
}
