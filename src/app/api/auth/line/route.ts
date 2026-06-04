import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { verifyLineIdToken, createDbSessionForUser } from "@/lib/liff-auth"

// LIFF 自動登入：前端（在 LINE in-app browser）用 liff.getIDToken() 拿到 idToken 後打這支，
// 後端驗證 idToken → 用 lineUserId 對應「已綁定」的系統 user → 建立 database session。
// 與 Google 登入並存，互不干擾（不走 NextAuth provider，session 自建但與其同構）。
// 用到 crypto / Prisma，固定走 Node runtime。
export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  let idToken: string | undefined
  try {
    const body = await req.json()
    idToken = body?.idToken
  } catch {
    return NextResponse.json({ status: "error", message: "invalid body" }, { status: 400 })
  }
  if (!idToken) {
    return NextResponse.json({ status: "error", message: "missing idToken" }, { status: 400 })
  }

  // 後端驗證 idToken（不信任前端傳來的 userId）
  const lineUserId = await verifyLineIdToken(idToken)
  if (!lineUserId) {
    return NextResponse.json({ status: "error", message: "invalid idToken" }, { status: 401 })
  }

  // 用 lineUserId 反查系統 user。
  // 綁定關係是先前員工以公司 Google 帳號登入後、透過 6 碼綁定碼建立的可信對應，
  // 所以這裡可以安全地以 lineUserId 作為身份依據（不繞過網域白名單）。
  const user = await prisma.user.findUnique({
    where: { lineUserId },
    select: { id: true, terminatedDate: true },
  })

  // fallback：皆回 HTTP 200 + status 欄位，讓前端好分辨並導引
  if (!user) {
    return NextResponse.json({ status: "unbound" })
  }
  if (user.terminatedDate) {
    return NextResponse.json({ status: "terminated" })
  }

  await createDbSessionForUser(user.id)
  return NextResponse.json({ status: "ok" })
}
