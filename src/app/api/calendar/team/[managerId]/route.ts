import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { buildICS, ICalEvent } from "@/lib/ical"

// 團隊請假行事曆訂閱：/api/calendar/team/{userId}.ics?token={calendarToken}
// 內容 = 以 root 為錨的整個小組（root + 所有直屬下屬）的 APPROVED 假單
// root 規則：若 userId 本身有 managerId → root = managerId（下屬看到整組）
//           否則 → root = userId（主管看到自己帶的組）
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ managerId: string }> }
) {
  const { managerId: rawUserId } = await ctx.params
  const userId = rawUserId.replace(/\.ics$/, "")
  const token = req.nextUrl.searchParams.get("token")
  if (!token) return new NextResponse("Missing token", { status: 401 })

  const dbUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, managerId: true, calendarToken: true },
  })
  if (!dbUser || dbUser.calendarToken !== token) {
    return new NextResponse("Invalid token", { status: 401 })
  }

  // 下屬 → 以其主管為錨；主管或無主管 → 以自己為錨
  const rootId = dbUser.managerId ?? dbUser.id

  const teamMembers = await prisma.user.findMany({
    where: { OR: [{ id: rootId }, { managerId: rootId }] },
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
    // 共享行事曆不放請假原因（可能含病況等隱私）；原因只出現在本人的個人行事曆
  }))

  const ics = buildICS(`團隊請假行事曆`, events)
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
    },
  })
}
