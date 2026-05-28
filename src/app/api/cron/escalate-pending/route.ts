import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { shouldSendLine, sendLineEscalation } from "@/lib/line"
import { shouldSendEmail, sendEscalationEmail, displayName } from "@/lib/email"

// 由外部 cron 觸發（平日 09–18 每小時）：找出「當前階段」已超過 2 天未處理的 PENDING 假單，
// 依兩階段審核通知「當前該審的人」：未過一審→一審主管(approverId)；已過一審→終審者(secondApproverId)。
// 每階段各算 2 天：一審由 createdAt 起算、二審由 firstApprovedAt 起算
//（一審通過時會把 escalatedAt 歸零，讓二審重新計時）。每階段只通知一次（escalatedAt 標記）避免重複騷擾。
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }
  const supplied = req.headers.get("x-cron-secret")
  if (supplied !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const threshold = new Date(Date.now() - 48 * 60 * 60 * 1000)

  const stale = await prisma.leaveRequest.findMany({
    where: {
      status: "PENDING",
      escalatedAt: null,
      // 當前階段已超過門檻：一審看 createdAt（firstApprovedAt 仍為 null）、二審看 firstApprovedAt
      OR: [
        { firstApprovedAt: null, createdAt: { lt: threshold } },
        { firstApprovedAt: { lt: threshold } },
      ],
    },
    include: {
      user: { select: { id: true, name: true, chineseName: true } },
      approver: { select: { id: true, name: true, chineseName: true } },
      leaveType: { select: { name: true } },
    },
  })

  if (stale.length === 0) {
    return NextResponse.json({ escalated: 0 })
  }

  // 兩階段審核：每筆單「當前該審的人」= 未過一審→一審主管(approverId)，已過一審→終審者(secondApproverId)
  const currentReviewerId = (r: (typeof stale)[number]) =>
    r.firstApprovedAt ? r.secondApproverId : r.approverId

  // 一次撈這些當前審核者的通知設定
  const reviewerIds = Array.from(
    new Set(stale.map(currentReviewerId).filter((id): id is string => !!id))
  )
  const reviewers = await prisma.user.findMany({
    where: { id: { in: reviewerIds }, terminatedDate: null },
    select: { id: true, email: true, lineUserId: true, lineNotifyPrefs: true, emailNotifyPrefs: true },
  })
  const reviewerById = new Map(reviewers.map((u) => [u.id, u]))

  const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:8080"
  const reviewLink = `${siteUrl}/admin/approvals`

  let escalatedCount = 0
  for (const req of stale) {
    const reviewerId = currentReviewerId(req)
    const reviewer = reviewerId ? reviewerById.get(reviewerId) : undefined
    // 找不到當前審核者（未指派 / 已離職）就跳過且不標記，待補上審核者後下次 cron 再通知
    if (!reviewer) continue

    // 顯示「當前階段」已等待時數：二審從 firstApprovedAt 起算，否則從 createdAt
    const stageStart = req.firstApprovedAt ?? req.createdAt
    const hours = Math.floor((Date.now() - stageStart.getTime()) / (60 * 60 * 1000))
    const applicantName = displayName(req.user?.name, req.user?.chineseName)
    const managerName = displayName(req.approver?.name, req.approver?.chineseName)
    const leaveTypeName = req.leaveType.name

    const tasks: Promise<unknown>[] = []
    if (shouldSendEmail(reviewer, "escalation")) {
      tasks.push(sendEscalationEmail(
        reviewer.email!,
        applicantName,
        managerName,
        leaveTypeName,
        req.startDate,
        req.endDate,
        req.partOfDay,
        req.durationDays,
        hours,
        reviewLink
      ))
    }
    if (shouldSendLine(reviewer, "escalation")) {
      tasks.push(sendLineEscalation(
        reviewer.lineUserId!,
        applicantName,
        managerName,
        leaveTypeName,
        req.startDate,
        req.endDate,
        hours,
        reviewLink
      ))
    }
    await Promise.allSettled(tasks)

    // 標記已通知，避免下次 cron 又通知一次
    await prisma.leaveRequest.update({
      where: { id: req.id },
      data: { escalatedAt: new Date() },
    })
    escalatedCount += 1
  }

  return NextResponse.json({ escalated: escalatedCount })
}
