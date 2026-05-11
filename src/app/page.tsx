import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { getUserLeaveBalance } from "@/lib/leave-utils"
import { Calendar } from "lucide-react"
import Link from "next/link"
import { YearlyHeatmap } from "./components/YearlyHeatmap"

export const metadata = {
  title: "Dashboard | Timeoff",
}

export default async function DashboardPage() {
  const session = await auth()
  
  if (!session?.user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Calendar className="w-16 h-16 text-gray-300 mb-4" />
        <h1 className="text-3xl font-bold text-gray-900">歡迎來到 PopIn 假勤系統</h1>
        <p className="mt-4 text-lg text-gray-600">請點擊右上角登入以查看您的假單</p>
      </div>
    )
  }

  const year = new Date().getFullYear()
  
  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
    include: { manager: true }
  })

  if (!user) return null;

  const leaveTypes = await prisma.leaveType.findMany()
  
  const balances = await Promise.all(
    leaveTypes.map(async (lt) => {
      const bal = await getUserLeaveBalance(user.id, lt.id, year)
      return { type: lt.name, ...bal }
    })
  )

  const history = await prisma.leaveRequest.findMany({
    where: { userId: user.id },
    include: { leaveType: true },
    orderBy: { createdAt: 'desc' },
    take: 10
  })

  // 取得年度所有的請假供熱圖使用
  const allLeavesThisYear = await prisma.leaveRequest.findMany({
    where: {
      userId: user.id,
      startDate: {
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1)
      }
    },
    select: { startDate: true, endDate: true, status: true }
  })

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {user.name} 的個人儀表板
          </h1>
          <p className="mt-2 text-gray-600">
            部門：{user.department || '未設定'} | 直屬主管：{user.manager?.name || '無'}
          </p>
        </div>
        <Link 
          href="/apply"
          className="px-6 py-2 bg-[var(--brand-primary)] text-white font-medium rounded-md shadow hover:bg-[var(--brand-primary-dark)] transition whitespace-nowrap"
        >
          ➕ 申請休假
        </Link>
      </div>

      {/* 年度熱圖 (手機版隱藏) */}
      <YearlyHeatmap leaves={allLeavesThisYear} year={year} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* 左側：剩餘天數列表 */}
        <div className="lg:col-span-1 space-y-4">
          <h2 className="text-lg font-medium text-gray-900 mb-4">{year} 年假別額度</h2>
          {balances.map(b => {
            const percentage = b.total > 0 ? (b.remaining / b.total) * 100 : 0
            
            return (
              <div key={b.type} className="bg-white p-5 rounded-lg shadow border border-gray-100">
                <div className="flex justify-between items-end mb-2">
                  <span className="font-medium text-gray-700">{b.type}</span>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-[var(--brand-primary)]">{b.remaining}</span>
                    <span className="text-sm text-gray-500 ml-1">/ {b.total} 天</span>
                  </div>
                </div>
                {/* 淺灰色底與主題色進度條 */}
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div 
                    className="bg-[var(--brand-primary)] h-2.5 rounded-full transition-all duration-500" 
                    style={{ width: `${percentage}%` }}
                  ></div>
                </div>
                <p className="text-xs text-gray-400 mt-2 text-right">已請: {b.used} 天</p>
              </div>
            )
          })}
        </div>

        {/* 右側：請假紀錄 */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-100 h-full">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
              <h2 className="text-lg font-medium text-gray-900">最近休假紀錄</h2>
            </div>
            {history.length === 0 ? (
              <div className="p-12 text-center text-gray-500 text-sm">目前尚無請假紀錄</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-white">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">假別 / 天數</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">日期區間</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">狀態</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map(req => (
                    <tr key={req.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{req.leaveType.name}</div>
                        <div className="text-gray-500 text-xs">{req.durationDays} 天</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-gray-900">
                          {req.startDate.toLocaleDateString('zh-TW')} - {req.endDate.toLocaleDateString('zh-TW')}
                        </div>
                        <div className="text-gray-500 text-xs">
                          {req.partOfDay === 'ALL_DAY' ? '全天' : req.partOfDay === 'MORNING' ? '上半天' : '下半天'}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full 
                          ${req.status === 'APPROVED' ? 'bg-green-100 text-green-800' : 
                            req.status === 'PENDING' ? 'bg-gray-200 text-gray-800' : 
                            req.status === 'REJECTED' ? 'bg-red-100 text-red-800' : 
                            'bg-gray-100 text-gray-800'}`}>
                          {req.status === 'APPROVED' ? '已核准' : 
                           req.status === 'PENDING' ? '待審核' : 
                           req.status === 'REJECTED' ? '已駁回' : req.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
