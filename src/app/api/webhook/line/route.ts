import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getUserLeaveBalance } from "@/lib/leave-utils"
import { reviewLeaveAsUser } from "@/app/actions/leave"
import {
  verifyLineSignature,
  lineReply,
  isBalanceQuery,
  buildBalanceReply,
  buildBindingSuccessReply,
  buildFollowGreeting,
  buildUnboundReply,
  buildHelpReply,
  buildRejectReasonFlex,
} from "@/lib/line"

// LINE Webhook：接收 follow / message / postback 事件
// 注意：簽章驗證需要原始 body 字串，不能 parse 後再 stringify
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get("x-line-signature") || ""

  if (!verifyLineSignature(rawBody, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 })
  }

  const events: any[] = payload?.events || []

  // 各事件之間互不相依，並行處理；個別失敗不擋其他
  await Promise.allSettled(events.map(handleEvent))

  return NextResponse.json({ ok: true })
}

async function handleEvent(event: any): Promise<void> {
  try {
    const lineUserId = event?.source?.userId
    if (!lineUserId) return

    if (event.type === "follow") {
      // 加好友 → 引導去系統拿綁定碼
      await lineReply(event.replyToken, buildFollowGreeting())
      return
    }

    if (event.type === "message" && event.message?.type === "text") {
      await handleTextMessage(event.replyToken, lineUserId, event.message.text)
      return
    }

    if (event.type === "postback" && event.postback?.data) {
      await handlePostback(event.replyToken, lineUserId, event.postback.data)
      return
    }
  } catch (err) {
    console.error("LINE webhook event handling error:", err)
  }
}

/**
 * 處理 Flex Message 的「快速核准」按鈕 postback。
 * data 格式：action=approve&requestId=<id>
 *           action=reject&requestId=<id>（不在 LINE 內處理，導回網頁，因為駁回必填理由）
 */
async function handlePostback(
  replyToken: string,
  lineUserId: string,
  data: string
): Promise<void> {
  const params = new URLSearchParams(data)
  const action = params.get("action")
  const requestId = params.get("requestId")

  if (!action || !requestId) return

  // 先看這個 LINE 帳號綁定到哪個 user
  const actor = await prisma.user.findUnique({
    where: { lineUserId },
    select: { id: true, terminatedDate: true },
  })
  if (!actor || actor.terminatedDate) {
    await lineReply(replyToken, [{ type: "text", text: "您的帳號未綁定或已停用，無法操作。" }])
    return
  }

  if (action === "approve") {
    try {
      await reviewLeaveAsUser(actor.id, requestId, "APPROVED")
      await lineReply(replyToken, [{ type: "text", text: "已核准。" }])
    } catch (err: any) {
      const msg = err?.message || "核准失敗"
      await lineReply(replyToken, [{ type: "text", text: msg }])
    }
    return
  }

  // 第一階段：按下「駁回」→ 回第二層 Flex 讓主管選預設理由
  if (action === "reject") {
    const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:8080"
    const link = `${siteUrl}/admin/approvals`
    const flex = buildRejectReasonFlex(requestId, link)
    await lineReply(replyToken, [
      { type: "flex", altText: "請選擇駁回理由", contents: flex },
    ])
    return
  }

  // 第二階段：主管選了某個預設理由（或選「直接駁回不附理由」）→ 完成駁回
  if (action === "reject_with_reason") {
    const reason = params.get("reason") || "" // 空字串代表沒理由
    try {
      await reviewLeaveAsUser(actor.id, requestId, "REJECTED", reason || undefined)
      const tail = reason ? `\n理由：${reason}` : "（未附理由）"
      await lineReply(replyToken, [{ type: "text", text: `已駁回。${tail}` }])
    } catch (err: any) {
      const msg = err?.message || "駁回失敗"
      await lineReply(replyToken, [{ type: "text", text: msg }])
    }
    return
  }
}

async function handleTextMessage(
  replyToken: string,
  lineUserId: string,
  text: string
): Promise<void> {
  const trimmed = text.trim()

  // 先看這個 LINE 帳號有沒有綁定過
  const boundUser = await prisma.user.findUnique({
    where: { lineUserId },
    select: { id: true, name: true, terminatedDate: true },
  })

  if (boundUser) {
    // 離職員工已綁定也不再服務查詢
    if (boundUser.terminatedDate) {
      await lineReply(replyToken, [
        { type: "text", text: "您的帳號目前已停用，如有疑問請聯絡管理員。" },
      ])
      return
    }

    // 已綁定 — 處理指令
    if (isBalanceQuery(trimmed)) {
      await handleBalanceQuery(replyToken, boundUser.id)
      return
    }

    await lineReply(replyToken, buildHelpReply())
    return
  }

  // 未綁定 — 看訊息是不是 6 碼綁定碼（generateBindingCode 用的字元集）
  if (/^[2-9A-HJ-NP-Z]{6}$/.test(trimmed)) {
    await handleBindingAttempt(replyToken, lineUserId, trimmed)
    return
  }

  // 未綁定 + 非綁定碼 → 提示去拿綁定碼
  await lineReply(replyToken, buildUnboundReply())
}

async function handleBindingAttempt(
  replyToken: string,
  lineUserId: string,
  code: string
): Promise<void> {
  const candidate = await prisma.user.findUnique({
    where: { lineBindingCode: code },
    select: {
      id: true,
      name: true,
      terminatedDate: true,
      lineBindingExpiry: true,
    },
  })

  if (!candidate) {
    await lineReply(replyToken, [
      { type: "text", text: "❌ 綁定碼無效，請到系統「個人設定」重新產生。" },
    ])
    return
  }

  if (candidate.terminatedDate) {
    await lineReply(replyToken, [
      { type: "text", text: "此帳號已停用，無法綁定。" },
    ])
    return
  }

  if (candidate.lineBindingExpiry && candidate.lineBindingExpiry < new Date()) {
    await lineReply(replyToken, [
      { type: "text", text: "⏰ 綁定碼已過期，請到系統「個人設定」重新產生。" },
    ])
    return
  }

  // 寫入綁定；遇到 lineUserId unique 衝突（這個 LINE 帳號已綁給別人）會拋錯
  try {
    await prisma.user.update({
      where: { id: candidate.id },
      data: {
        lineUserId,
        lineBindingCode: null,
        lineBindingExpiry: null,
        lineBoundAt: new Date(),
      },
    })
  } catch (err: any) {
    // P2002 = unique constraint violation
    if (err?.code === "P2002") {
      await lineReply(replyToken, [
        {
          type: "text",
          text: "此 LINE 帳號已綁定到其他員工，請先到原帳號的「個人設定」解綁後再試。",
        },
      ])
      return
    }
    throw err
  }

  await lineReply(replyToken, buildBindingSuccessReply(candidate.name))
}

async function handleBalanceQuery(replyToken: string, userId: string): Promise<void> {
  const year = new Date().getFullYear()
  const leaveTypes = await prisma.leaveType.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  })

  const lines: string[] = []
  for (const lt of leaveTypes) {
    try {
      const bal = await getUserLeaveBalance(userId, lt.id)
      // 顯示成「可請 X / 全年 Y 天」；total 為 0 也照顯（讓員工知道沒有此假別）
      lines.push(`${lt.name}：可請 ${formatDays(bal.remaining)} / 全年 ${formatDays(bal.total)} 天`)
    } catch (err) {
      console.error(`getUserLeaveBalance failed for ${lt.name}:`, err)
    }
  }

  await lineReply(replyToken, buildBalanceReply(year, lines))
}

function formatDays(n: number): string {
  // 整數顯示整數、小數保留一位
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
