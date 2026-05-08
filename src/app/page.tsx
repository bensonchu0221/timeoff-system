import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { getUserLeaveBalance } from "@/lib/leave-utils"
import Link from "next/link"
import { Calendar } from "lucide-react"

export default async function DashboardPage() {
  const session = await auth()
  
  if (!session?.user) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh]">
        <Calendar className="w-16 h-16 text-gray-300 mb-4" />
        <h2 className="text-xl font-medium text-gray-700">請先登入以使用假勤系統</h2>
      </div>
    )
  }

  const year = new Date().getFullYear()
  const leaveTypes = await prisma.leaveType.findMany()
  
  // Calculate balances for all leave types for this user
  const balances = await Promise.all(
    leaveTypes.map(async (lt) => {
      const bal = await getUserLeaveBalance(session.user!.id!, lt.id, year)
      return { type: lt.name, ...bal }
    })
  )

  // Get recent leave history
  const history = await prisma.leaveRequest.findMany({
    where: { userId: session.user.id },
    include: { leaveType: true },
    orderBy: { createdAt: 'desc' },
    take: 10
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">我的假勤 ({year})</h1>
        <Link 
          href="/apply"
          className="bg-[var(--brand-primary)] text-white px-4 py-2 rounded shadow hover:bg-[var(--brand-primary-dark)] transition"
        >
          申請休假
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {balances.map(b => (
          <div key={b.type} className="bg-white p-6 rounded-lg shadow border border-gray-100 flex flex-col items-center justify-center text-center">
            <span className="text-sm font-medium text-gray-500 uppercase tracking-wider">{b.type}</span>
            <div className="mt-2 text-3xl font-bold text-[var(--brand-primary)]">{b.remaining} 天</div>
            <span className="mt-1 text-xs text-gray-400">總共: {b.total} | 已休: {b.used}</span>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-100 mt-8">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h2 className="text-lg font-medium text-gray-900">休假紀錄</h2>
        </div>
        {history.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">目前尚無請假紀錄</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-white">
              <tr>
                <th className="px-6 py-3 text-left font-medium text-gray-500">假別</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">開始日期</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">結束日期</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">天數</th>
                <th className="px-6 py-3 text-left font-medium text-gray-500">狀態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map(req => (
                <tr key={req.id}>
                  <td className="px-6 py-4">{req.leaveType.name}</td>
                  <td className="px-6 py-4">{req.startDate.toLocaleDateString('zh-TW')}</td>
                  <td className="px-6 py-4">{req.endDate.toLocaleDateString('zh-TW')}</td>
                  <td className="px-6 py-4">{req.durationDays} 天</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                      ${req.status === 'APPROVED' ? 'bg-green-100 text-green-800' : 
                        req.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' : 
                        req.status === 'REJECTED' ? 'bg-red-100 text-red-800' : 
                        'bg-gray-100 text-gray-800'}`}>
                      {req.status}
                    </span>
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
