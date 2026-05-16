import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { buildICS, ICalEvent } from "@/lib/ical"

// 團隊請假行事曆訂閱：/api/calendar/team/{managerId}.ics?token={managerCalendarToken}
// 內容 = 該主管自己 + 直屬下屬 的 APPROVED 假單
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ managerId: string }> }
) {
  const { managerId: rawManagerId } = await ctx.params
  const managerId = rawManagerId.replace(/\.ics$/, "")
  const token = req.nextUrl.searchParams.get("token")
  if (!token) return new NextResponse("Missing token", { status: 401 })

  const manager = await prisma.user.findUnique({
    where: { id: managerId },
    select: { id: true, name: true, role: true, calendarToken: true },
  })
  if (!manager || manager.calendarToken !== token) {
    return new NextResponse("Invalid token", { status: 401 })
  }
  if (manager.role !== "MANAGER" && manager.role !== "ADMIN") {
    return new NextResponse("Not a manager", { status: 403 })
  }

  // 找團隊成員：自己 + 直屬下屬（不論在職或離職，舊事件仍要顯示）
  const teamMembers = await prisma.user.findMany({
    where: { OR: [{ id: managerId }, { managerId }] },
    select: { id: true, name: true },
  })
  const memberMap = new Map(teamMembers.map((m) => [m.id, m.name]))

  const leaves = await prisma.leaveRequest.findMany({
    where: { userId: { in: Array.from(memberMap.keys()) }, status: "APPROVED" },
    include: { leaveType: true },
    orderBy: { startDate: "asc" },
  })

  const events: ICalEvent[] = leaves.map((l) => ({
    uid: `leave-${l.id}@timeoff`,
    startDate: l.startDate,
    endDate: l.endDate,
    summary: `${memberMap.get(l.userId) || "員工"} - ${l.leaveType.name}${l.partOfDay !== "ALL_DAY" ? ` (${l.partOfDay === "MORNING" ? "上半天" : "下半天"})` : ""}`,
    description: l.reason || undefined,
  }))

  const ics = buildICS(`${manager.name || "主管"} 團隊請假行事曆`, events)
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  })
}
