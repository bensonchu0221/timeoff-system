import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { shouldSendLine, sendLineDailyRoster } from "@/lib/line"
import { todayStartUTCFromTaipei } from "@/lib/date-format"

// 每日 10:00 由外部 cron 觸發：把今天所有 APPROVED 的請假成員 push 給「全公司在職員工」
// 認證：x-cron-secret header
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  }
  const supplied = req.headers.get("x-cron-secret")
  if (supplied !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  // 今天的範圍：以台北時區 00:00 為界
  const today = todayStartUTCFromTaipei()
  const tomorrow = new Date(today)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)

  // 找出今天有人請假（startDate <= today <= endDate）的所有 APPROVED 單
  const todayLeaves = await prisma.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      startDate: { lt: tomorrow },
      endDate: { gte: today },
    },
    include: {
      user: { select: { id: true, name: true } },
      leaveType: { select: { name: true } },
    },
    orderBy: { user: { name: "asc" } },
  })

  if (todayLeaves.length === 0) {
    return NextResponse.json({ pushed: 0, reason: "no one is on leave today" })
  }

  // 通知對象：全公司在職且已綁定 LINE 的員工（不再限同部門）
  const recipients = await prisma.user.findMany({
    where: {
      terminatedDate: null,
      lineUserId: { not: null },
    },
    select: { id: true, lineUserId: true, lineNotifyPrefs: true },
  })

  const tw = new Date(today.toLocaleString("en-US", { timeZone: "Asia/Taipei" }))
  const dateLabel = `${tw.getMonth() + 1}/${tw.getDate()}`

  let pushed = 0
  await Promise.allSettled(
    recipients.map(async (u) => {
      if (!shouldSendLine(u, "dailyRoster")) return
      // 把「自己今天也請假」的那筆從名單裡濾掉，避免「您 + 同事 X 今天請假」這種尷尬
      // 若濾掉自己後沒人剩下，這位接收者就略過（不要只看到「今日請假：（空）」）
      const filtered = todayLeaves.filter((l) => l.user.id !== u.id)
      if (filtered.length === 0) return

      const rosterLines = filtered.map((l) => {
        const partLabel =
          l.partOfDay === "MORNING"
            ? "（上半天）"
            : l.partOfDay === "AFTERNOON"
            ? "（下半天）"
            : ""
        return `• ${l.user.name || "員工"}：${l.leaveType.name}${partLabel}`
      })

      await sendLineDailyRoster(u.lineUserId!, dateLabel, rosterLines)
      pushed += 1
    })
  )

  return NextResponse.json({
    pushed,
    totalRecipients: recipients.length,
    leavesToday: todayLeaves.length,
  })
}
