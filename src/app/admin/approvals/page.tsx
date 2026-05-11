import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { reviewLeave } from "@/app/actions/leave"

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

  // Find all pending leave requests for users managed by this manager
  const pendingRequests = await prisma.leaveRequest.findMany({
    where: {
      status: "PENDING",
      user: {
        managerId: user.id
      }
    },
    include: {
      user: true,
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

      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        {pendingRequests.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            目前沒有需要審核的假單
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">申請人</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">假別 / 天數</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">請假區間</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">事由</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {pendingRequests.map((req) => (
                <tr key={req.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      {req.user.image ? (
                        <img className="h-8 w-8 rounded-full mr-3" src={req.user.image} alt="" />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-gray-200 mr-3"></div>
                      )}
                      <div>
                        <div className="text-sm font-medium text-gray-900">{req.user.name}</div>
                        <div className="text-sm text-gray-500">{req.user.department || '未設定部門'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">{req.leaveType.name}</div>
                    <div className="text-sm text-[var(--brand-primary)] font-bold">{req.durationDays} 天</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900">
                      {req.startDate.toLocaleDateString('zh-TW')} - {req.endDate.toLocaleDateString('zh-TW')}
                    </div>
                    <div className="text-xs text-gray-500">
                      時段: {req.partOfDay === 'ALL_DAY' ? '全天' : req.partOfDay === 'MORNING' ? '上半天' : '下半天'}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-900 max-w-xs truncate" title={req.reason || ''}>
                      {req.reason || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <form className="inline-flex space-x-2">
                      <input type="hidden" name="leaveId" value={req.id} />
                      <button
                        formAction={async (formData) => {
                          "use server"
                          await reviewLeave(formData.get("leaveId") as string, "APPROVED")
                        }}
                        className="bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1 rounded-md transition"
                      >
                        核准
                      </button>
                      <button
                        formAction={async (formData) => {
                          "use server"
                          await reviewLeave(formData.get("leaveId") as string, "REJECTED")
                        }}
                        className="bg-red-100 text-red-700 hover:bg-red-200 px-3 py-1 rounded-md transition"
                      >
                        駁回
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
