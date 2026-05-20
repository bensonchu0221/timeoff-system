import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { buildICS, ICalEvent } from "@/lib/ical"

// 全公司請假行事曆訂閱：/api/calendar/company/{userId}.ics?token={calendarToken}
// 內容 = 全公司所有人的 APPROVED 假單
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ userId: string }> }
) {
  const { userId: rawUserId } = await ctx.params
  const userId = rawUserId.replace(/\.ics$/, "")
  const token = req.nextUrl.searchParams.get("token")
  if (!token) return new NextResponse("Missing token", { status: 401 })

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { calendarToken: true },
  })
  if (!dbUser || dbUser.calendarToken !== token) {
    return new NextResponse("Invalid token", { status: 401 })
  }

  const allUsers = await prisma.user.findMany({
    select: { id: true, name: true },
  })
  const memberMap = new Map(allUsers.map((u) => [u.id, u.name]))

  const leaves = await prisma.leaveRequest.findMany({
    where: { status: "APPROVED" },
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

  const ics = buildICS(`全公司請假行事曆`, events)
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  })
}
