import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { shouldSendLine, sendLineDailyPending } from "@/lib/line"
import { todayStartUTCFromTaipei } from "@/lib/date-format"
import { isTaipeiWorkDay } from "@/lib/leave-utils"

// 每日 11:00 由外部 cron 觸發：把每位主管當下還有幾筆待審 push 到 LINE
// 認證：header x-cron-secret 必須等於 CRON_SECRET（避免被外部任意呼叫）
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }
  const supplied = req.headers.get("x-cron-secret")
  if (supplied !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  // 非工作日（六日 / 國定假日）沒人上班，整支跳過不推播
  if (!(await isTaipeiWorkDay(todayStartUTCFromTaipei()))) {
    return NextResponse.json({ pushed: 0, reason: "today is not a work day" })
  }

  // 撈所有 PENDING 假單，依「目前階段的審核者」分桶：
  // 兩階段審核下，已過一審（firstApprovedAt 非 null）的單目前在終審者（secondApproverId）手上，
  // 不該再算到一審主管頭上。
  const pending = await prisma.leaveRequest.findMany({
    where: { status: "PENDING" },
    select: { approverId: true, secondApproverId: true, firstApprovedAt: true },
  })

  const countByApprover = new Map<string, number>()
  for (const p of pending) {
    const currentReviewerId = p.firstApprovedAt ? p.secondApproverId : p.approverId
    if (!currentReviewerId) continue
    countByApprover.set(currentReviewerId, (countByApprover.get(currentReviewerId) || 0) + 1)
  }

  if (countByApprover.size === 0) {
    return NextResponse.json({ pushed: 0, reason: "no pending requests" })
  }

  // 一次撈這些 approver 的 LINE 設定
  const approvers = await prisma.user.findMany({
    where: {
      id: { in: Array.from(countByApprover.keys()) },
      terminatedDate: null,
    },
    select: { id: true, lineUserId: true, lineNotifyPrefs: true },
  })

  const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:8080"
  const reviewLink = `${siteUrl}/admin/approvals`

  let pushed = 0
  await Promise.allSettled(
    approvers.map(async (m) => {
      if (!shouldSendLine(m, "dailyPending")) return
      const count = countByApprover.get(m.id) || 0
      if (count === 0) return
      await sendLineDailyPending(m.lineUserId!, count, reviewLink)
      pushed += 1
    })
  )

  return NextResponse.json({ pushed, totalManagers: approvers.length })
}
