import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { buildICS, ICalEvent } from "@/lib/ical"
import { partsLabel } from "@/lib/leave-period"

// 有半天時加註時段，例：「 (上半天)」「 (首日下午開始)」；全天不加
const halfDayNote = (l: { startDate: Date; endDate: Date; partOfDay: string; endPartOfDay: string }) => {
  const label = partsLabel(l.startDate, l.endDate, l)
  return label === "全天" ? "" : ` (${label})`
}

// 個人請假行事曆訂閱：/api/calendar/{userId}.ics?token={calendarToken}
// userId 路由參數可帶 .ics 副檔名（Calendar 用戶端比較相容），這裡先 strip
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ userId: string }> }
) {
  const { userId: rawUserId } = await ctx.params
  const userId = rawUserId.replace(/\.ics$/, "")
  const token = req.nextUrl.searchParams.get("token")
  if (!token) return new NextResponse("Missing token", { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, calendarToken: true, terminatedDate: true },
  })
  if (!user || user.calendarToken !== token) {
    return new NextResponse("Invalid token", { status: 401 })
  }

  // 已離職員工的訂閱仍可讀（HR 可能要回顧歷史），但不再有新事件
  const leaves = await prisma.leaveRequest.findMany({
    where: { userId, status: "APPROVED" },
    include: { leaveType: true },
    orderBy: { startDate: "asc" },
  })

  const events: ICalEvent[] = leaves.map((l) => ({
    uid: `leave-${l.id}@timeoff`,
    startDate: l.startDate,
    endDate: l.endDate,
    summary: `${user.name || "員工"} - ${l.leaveType.name}${halfDayNote(l)}`,
    description: l.reason || undefined,
  }))

  const ics = buildICS(`${user.name || "員工"} 請假行事曆`, events)
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  })
}
