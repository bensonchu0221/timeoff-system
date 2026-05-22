import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { getSignedReadUrl } from "@/lib/gcs"

// GET /api/leave/[id]/attachments/[attId]
// 回傳該附件的短期 signed GET URL（5 分鐘），由前端直接打 GCS 預覽 / 下載。
// 權限：本人 / 直屬主管 / admin（與列表一致；代理人 backup 看不到）。
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; attId: string }> }
) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: leaveRequestId, attId } = await ctx.params

  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const att = await prisma.leaveAttachment.findUnique({
    where: { id: attId },
    select: {
      id: true,
      objectPath: true,
      mimeType: true,
      originalName: true,
      leaveRequest: {
        select: {
          id: true,
          userId: true,
          user: { select: { managerId: true } },
        },
      },
    },
  })
  if (!att || att.leaveRequest.id !== leaveRequestId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const isOwner = att.leaveRequest.userId === me.id
  const isManager = att.leaveRequest.user.managerId === me.id
  const isAdmin = me.role === "ADMIN"
  if (!isOwner && !isManager && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const url = await getSignedReadUrl(att.objectPath, 300)
  return NextResponse.json({
    url,
    mimeType: att.mimeType,
    originalName: att.originalName,
  })
}
