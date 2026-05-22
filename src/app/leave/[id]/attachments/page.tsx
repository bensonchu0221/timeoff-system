import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect, notFound } from "next/navigation"
import Link from "next/link"
import { formatTaipeiDate } from "@/lib/date-format"
import { AttachmentManager } from "@/app/components/AttachmentManager"

export const metadata = {
  title: "假單附件 | Timeoff",
}

// 純附件管理頁：給「事後補件」用（PENDING/APPROVED 都可進入）。
// 權限：本人可上傳、檢視；主管/admin 進來只能檢視（canUpload=false）。
export default async function LeaveAttachmentsPage(
  props: { params: Promise<{ id: string }> }
) {
  const { id } = await props.params
  const session = await auth()
  if (!session?.user?.email) redirect("/")

  const me = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!me) redirect("/")

  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      startDate: true,
      endDate: true,
      partOfDay: true,
      durationDays: true,
      reason: true,
      leaveType: { select: { name: true, requireProof: true } },
      user: { select: { id: true, name: true, email: true, managerId: true } },
    },
  })
  if (!leave) notFound()

  const isOwner = leave.userId === me.id
  const isManager = leave.user.managerId === me.id
  const isAdmin = me.role === "ADMIN"
  if (!isOwner && !isManager && !isAdmin) {
    return <div className="p-6 text-red-500">您無權檢視此假單的附件。</div>
  }

  // 只有本人 + status ∈ {PENDING, APPROVED} 才能上傳；他人僅檢視
  const canUpload = isOwner && (leave.status === "PENDING" || leave.status === "APPROVED")

  const statusLabel: Record<typeof leave.status, string> = {
    PENDING: "待審",
    APPROVED: "核准",
    REJECTED: "駁回",
    CANCELLED: "銷假",
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">假單附件</h1>
        <Link href="/" className="text-sm text-blue-600 hover:underline">← 返回首頁</Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-5 text-sm">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-gray-500">申請人</div>
            <div className="font-medium">{leave.user.name || leave.user.email}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">假別</div>
            <div className="font-medium">{leave.leaveType.name}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">日期</div>
            <div className="font-medium">
              {formatTaipeiDate(leave.startDate)} ~ {formatTaipeiDate(leave.endDate)}
            </div>
            <div className="text-xs text-gray-500">
              {leave.partOfDay === "ALL_DAY" ? "全天" : leave.partOfDay === "MORNING" ? "上半天" : "下半天"} / {leave.durationDays} 天
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500">狀態</div>
            <div className="font-medium">{statusLabel[leave.status]}</div>
          </div>
        </div>
        {leave.reason && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="text-xs text-gray-500">事由</div>
            <div className="text-gray-700 whitespace-pre-wrap">{leave.reason}</div>
          </div>
        )}
      </div>

      <AttachmentManager
        leaveRequestId={leave.id}
        canUpload={canUpload}
        hint={
          leave.leaveType.requireProof && canUpload
            ? "此假別需附上證明文件，可在審核前後補上。"
            : !canUpload && isOwner
              ? "此假單已關閉，無法再新增附件。"
              : undefined
        }
      />
    </div>
  )
}
