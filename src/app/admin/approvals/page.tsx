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

  // ADMIN 看全公司所有 PENDING，方便代為審核；MANAGER 只看自己下屬
  const pendingRequests = await prisma.leaveRequest.findMany({
    where: {
      status: "PENDING",
      ...(user.role === "ADMIN" ? {} : { user: { managerId: user.id } })
    },
    include: {
      user: { include: { department: { select: { name: true } } } },
      leaveType: true,
    },
    orderBy: {
      createdAt: 'asc'
    }
  })

  // Admin can see everything if they want, but usually approvals are for direct reports.
  // For simplicity, we just fetch direct reports' pending requests.

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">待審核假單</h1>
        <p className="mt-1 text-sm text-gray-500">
          這些是您的直屬下屬送出的請假申請。
        </p>
      </div>

      <ApprovalsTable pendingRequests={pendingRequests} />
    </div>
  )
}
