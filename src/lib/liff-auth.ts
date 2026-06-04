import { randomBytes } from "crypto"
import { cookies } from "next/headers"
import { prisma } from "@/lib/db"

// LIFF 自動登入用的後端工具。
// 設計重點：不走 NextAuth Credentials provider（v5 的 Credentials 會強制改用 JWT，
// 與現有 Google 的 database session 衝突），改為「自己建一筆 database session row +
// 寫入與 NextAuth 完全同構的 session cookie」。如此 auth() / signOut() 全部沿用。

// session 效期 30 天，與 @auth/core 預設一致
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

/**
 * 是否使用 secure cookie（__Secure- 前綴）。
 * 必須與 @auth/core 的判定完全一致，否則 auth() 會找不到我們自建的 session。
 * @auth/core 的 useSecureCookies = (AUTH_URL ?? NEXTAUTH_URL) 的 protocol === "https:"
 * （見 node_modules/@auth/core/lib/utils/env.js createActionURL 與 init.js）
 */
function secureCookiesEnabled(): boolean {
  const envUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL
  if (!envUrl) return false
  try {
    return new URL(envUrl).protocol === "https:"
  } catch {
    return false
  }
}

/**
 * database session 的 cookie 名稱，需與 NextAuth 產生的完全一致。
 * 線上 https → `__Secure-authjs.session-token`；本地 http → `authjs.session-token`。
 */
export function getSessionCookieName(): string {
  return secureCookiesEnabled() ? "__Secure-authjs.session-token" : "authjs.session-token"
}

/**
 * 後端驗證 LIFF 傳來的 idToken（打 LINE 官方 verify endpoint）。
 * 一律以後端驗證為準，不信任前端自行解出的 userId。
 * - client_id 用 LIFF 所屬 channel 的 id（aud 必須相符，否則 verify 會失敗）
 * @returns 驗證成功回 LINE userId（sub），失敗回 null
 */
export async function verifyLineIdToken(idToken: string): Promise<string | null> {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID || process.env.LINE_CHANNEL_ID
  if (!clientId) {
    console.error("LIFF 登入：缺少 LINE_CHANNEL_ID / LINE_LOGIN_CHANNEL_ID，無法驗證 idToken")
    return null
  }

  try {
    const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
    })
    if (!res.ok) {
      console.error(`LINE idToken verify 失敗 (${res.status}):`, await res.text())
      return null
    }
    const payload = await res.json()
    // verify endpoint 已驗簽 + 驗 aud + exp；這裡再確認 iss 與 sub 存在
    if (payload.iss !== "https://access.line.me" || !payload.sub) return null
    return payload.sub as string
  } catch (err) {
    console.error("LINE idToken verify error:", err)
    return null
  }
}

/**
 * 為指定 user 建立一筆 database session，並寫入 session cookie。
 * 產生的 session 與 Google 登入完全同構（auth() 讀得到、signOut() 刪得掉）。
 */
export async function createDbSessionForUser(userId: string): Promise<void> {
  const sessionToken = randomBytes(32).toString("hex")
  const expires = new Date(Date.now() + SESSION_MAX_AGE_MS)

  await prisma.session.create({ data: { sessionToken, userId, expires } })

  const cookieStore = await cookies()
  cookieStore.set(getSessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookiesEnabled(),
    expires,
  })
}
