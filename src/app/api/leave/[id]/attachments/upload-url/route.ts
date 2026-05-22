import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import {
  ALLOWED_MIMES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  buildObjectPath,
  extFromMime,
  getSignedUploadUrl,
} from "@/lib/gcs"

// POST /api/leave/[id]/attachments/upload-url
// 員工拿 v4 signed PUT URL；之後 PUT 完成需再呼叫 POST /attachments 寫 DB
// 允許上傳的時機：status ∈ { PENDING, APPROVED } — 補件視同 PENDING 處理
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
    | { fileName?: string; mimeType?: string; sizeBytes?: number }
    | null

  if (!body?.fileName || !body?.mimeType || typeof body.sizeBytes !== "number") {
    return NextResponse.json(
      { error: "fileName / mimeType / sizeBytes required" },
      { status: 400 }
    )
  }

  // 後端 hard validate；前端做的只是 UX
  if (!(ALLOWED_MIMES as readonly string[]).includes(body.mimeType)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
  }
  if (body.sizeBytes <= 0 || body.sizeBytes > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 400 })
  }
  const ext = extFromMime(body.mimeType)
  if (!ext) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
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
  if (!leave) {
    return NextResponse.json({ error: "Leave request not found" }, { status: 404 })
  }
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

  const objectPath = buildObjectPath(me.id, leave.id, ext)
  const { url, headers } = await getSignedUploadUrl({
    objectPath,
    mimeType: body.mimeType,
    maxBytes: MAX_FILE_BYTES,
    expiresInSeconds: 600,
  })

  return NextResponse.json({ uploadUrl: url, headers, objectPath })
}
