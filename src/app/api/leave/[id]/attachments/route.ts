import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import {
  ALLOWED_MIMES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
} from "@/lib/gcs"

// GET /api/leave/[id]/attachments
// 列出某張請假單的所有附件，按 createdAt asc（最舊在上，可看出補件順序）。
// 可看者：本人 / 直屬主管 / admin（代理人 backup 看不到）。
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: leaveRequestId } = await ctx.params

  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    select: {
      id: true,
      userId: true,
      user: { select: { managerId: true } },
    },
  })
  if (!leave) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const isOwner = leave.userId === me.id
  const isManager = leave.user.managerId === me.id
  const isAdmin = me.role === "ADMIN"
  if (!isOwner && !isManager && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const items = await prisma.leaveAttachment.findMany({
    where: { leaveRequestId: leave.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedById: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ items })
}

// POST /api/leave/[id]/attachments
// 員工 PUT 完成後 callback，將 GCS object 註冊到 DB。
// 不直接寫檔到 DB，而是先簽 URL 上傳，再呼叫此 endpoint。
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: leaveRequestId } = await ctx.params
  const body = (await req.json().catch(() => null)) as
    | { objectPath?: string; originalName?: string; mimeType?: string; sizeBytes?: number }
    | null

  if (
    !body?.objectPath ||
    !body?.originalName ||
    !body?.mimeType ||
    typeof body.sizeBytes !== "number"
  ) {
    return NextResponse.json(
      { error: "objectPath / originalName / mimeType / sizeBytes required" },
      { status: 400 }
    )
  }

  if (!(ALLOWED_MIMES as readonly string[]).includes(body.mimeType)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
  }
  if (body.sizeBytes <= 0 || body.sizeBytes > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 400 })
  }

  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, terminatedDate: true },
  })
  if (!me || me.terminatedDate) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveRequestId },
    select: {
      id: true,
      userId: true,
      status: true,
      _count: { select: { attachments: true } },
    },
  })
  if (!leave) return NextResponse.json({ error: "Leave request not found" }, { status: 404 })
  if (leave.userId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  if (leave.status !== "PENDING" && leave.status !== "APPROVED") {
    return NextResponse.json(
      { error: "This leave request can no longer accept attachments" },
      { status: 409 }
    )
  }
  if (leave._count.attachments >= MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Maximum ${MAX_FILES_PER_REQUEST} files per request` },
      { status: 409 }
    )
  }

  // 防偽造：objectPath 必須落在 {prefix}/{me.id}/{leave.id}/ 下，否則拒收
  const expectedPrefix = `${process.env.GCS_PREFIX}/${me.id}/${leave.id}/`
  if (!body.objectPath.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: "Invalid objectPath" }, { status: 400 })
  }

  const item = await prisma.leaveAttachment.create({
    data: {
      leaveRequestId: leave.id,
      objectPath: body.objectPath,
      originalName: body.originalName.slice(0, 255),
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      uploadedById: me.id,
    },
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      uploadedById: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ item }, { status: 201 })
}
