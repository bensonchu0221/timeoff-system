import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { shouldSendLine, sendLineEscalation } from "@/lib/line"
import { sendEscalationEmail, displayName } from "@/lib/email"

// 由外部 cron 觸發：找出 PENDING 超過 24 小時且尚未升級過的假單，通知 admin
// 每筆假單只升級一次（用 escalatedAt 標記），避免重複騷擾
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }
  const supplied = req.headers.get("x-cron-secret")
  if (supplied !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const threshold = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const stale = await prisma.leaveRequest.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: threshold },
      escalatedAt: null,
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

  // 一次撈所有 admin 當收件人
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", terminatedDate: null },
    select: { id: true, email: true, lineUserId: true, lineNotifyPrefs: true },
  })

  const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:8080"
  const reviewLink = `${siteUrl}/admin/approvals`

  let escalatedCount = 0
  for (const req of stale) {
    const hours = Math.floor((Date.now() - req.createdAt.getTime()) / (60 * 60 * 1000))
    const applicantName = displayName(req.user?.name, req.user?.chineseName)
    const managerName = displayName(req.approver?.name, req.approver?.chineseName)
    const leaveTypeName = req.leaveType.name

    await Promise.allSettled(
      admins.flatMap((admin) => {
        const tasks: Promise<unknown>[] = []
        if (admin.email) {
          tasks.push(sendEscalationEmail(
            admin.email,
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
        if (shouldSendLine(admin, "escalation")) {
          tasks.push(sendLineEscalation(
            admin.lineUserId!,
            applicantName,
            managerName,
            leaveTypeName,
            req.startDate,
            req.endDate,
            hours,
            reviewLink
          ))
        }
        return tasks
      })
    )

    // 標記已升級，避免下次 cron 又通知一次
    await prisma.leaveRequest.update({
      where: { id: req.id },
      data: { escalatedAt: new Date() },
    })
    escalatedCount += 1
  }

  return NextResponse.json({
    escalated: escalatedCount,
    admins: admins.length,
  })
}
