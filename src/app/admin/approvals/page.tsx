import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { ApprovalsTable } from "./ApprovalsTable"

export const metadata = {
  title: "審核假單 | Timeoff",
}

export default async function ApprovalsPage() {
  const session = await auth()
  if (!session?.user) redirect("/")

  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
  })

  if (!user || (user.role !== "MANAGER" && user.role !== "ADMIN")) {
    return <div className="p-6 text-red-500">權限不足：您必須是主管或管理員才能審核假單。</div>
  }

  // 兩階段審核分流：
  // - ADMIN：看全公司所有 PENDING（兩關都能代審）。
  // - 其他人：看「指派給自己的一審」(approverId=自己 且 firstApprovedAt=null)
  //   + 「指派給自己的二審」(secondApproverId=自己 且 firstApprovedAt 非 null，終審者才會有)。
  const pendingRaw = await prisma.leaveRequest.findMany({
    where: {
      status: "PENDING",
      ...(user.role === "ADMIN" ? {} : {
        OR: [
          { approverId: user.id, firstApprovedAt: null },
          { secondApproverId: user.id, firstApprovedAt: { not: null } },
        ],
      })
    },
    include: {
      user: { include: { department: { select: { name: true } } } },
      leaveType: { select: { name: true, requireProof: true } },
      _count: { select: { attachments: true } },
    },
    orderBy: {
      createdAt: 'asc'
    }
  })

  // 攤平 _count 給 client component，避免 Prisma type 細節外露
  // stage：目前待審階段（1=主管一審、2=Boss 二審）；isTwoStage：此單是否需二審
  const pendingRequests = pendingRaw.map((r) => ({
    ...r,
    attachmentCount: r._count.attachments,
    stage: r.firstApprovedAt ? 2 : 1,
    isTwoStage: r.secondApproverId != null,
  }))

  // Admin can see everything if they want, but usually approvals are for direct reports.
  // For simplicity, we just fetch direct reports' pending requests.

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">待審核假單</h1>
        <p className="mt-1 text-sm text-gray-500">
          這裡是等您審核的假單；標示「二審」者為已通過主管一審、待您終審的假單。
        </p>
      </div>

      <ApprovalsTable pendingRequests={pendingRequests} />
    </div>
  )
}
