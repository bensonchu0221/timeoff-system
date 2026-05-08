import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"

export const metadata = {
  title: "團隊請假甘特圖 | Timeoff",
}

export default async function GanttPage() {
  const session = await auth()
  if (!session?.user) redirect("/")

  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
  })

  if (!user || (user.role !== "MANAGER" && user.role !== "ADMIN")) {
    return <div className="p-6 text-red-500">權限不足：您必須是主管或管理員。</div>
  }

  // 決定要顯示誰的資料
  // 如果是 Admin，看全公司；如果是 Manager，看下屬 + 自己
  const targetUsers = await prisma.user.findMany({
    where: user.role === "ADMIN" ? {} : {
      OR: [
        { id: user.id },
        { managerId: user.id }
      ]
    },
    orderBy: {
      department: 'asc'
    }
  })

  const userIds = targetUsers.map(u => u.id)

  // 取得這些人最近前後一個月的假單 (已核准或審核中)
  const today = new Date()
  const startDate = new Date(today)
  startDate.setDate(today.getDate() - 14) // 兩週前
  const endDate = new Date(today)
  endDate.setDate(today.getDate() + 14)   // 兩週後

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      userId: { in: userIds },
      status: { in: ["APPROVED", "PENDING"] },
      OR: [
        { startDate: { lte: endDate, gte: startDate } },
        { endDate: { lte: endDate, gte: startDate } },
        { startDate: { lte: startDate }, endDate: { gte: endDate } }
      ]
    },
    include: {
      leaveType: true
    }
  })

  // 產生 X 軸的日期陣列
  const days = []
  const current = new Date(startDate)
  while (current <= endDate) {
    days.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }

  // Helper to check if a specific date falls within a leave request
  const isDateInLeave = (date: Date, leaveStart: Date, leaveEnd: Date) => {
    const d = new Date(date).setHours(0,0,0,0)
    const s = new Date(leaveStart).setHours(0,0,0,0)
    const e = new Date(leaveEnd).setHours(0,0,0,0)
    return d >= s && d <= e
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">團隊請假甘特圖</h1>
        <p className="mt-1 text-sm text-gray-500">
          顯示前後兩週的請假狀況，避免多人同時休假。
        </p>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto border border-gray-200">
        <table className="min-w-max w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-gray-100 px-4 py-3 border-b border-r border-gray-200 text-left text-xs font-medium text-gray-600 uppercase w-48 shadow-[1px_0_0_0_#e5e7eb]">
                成員
              </th>
              {days.map((day, idx) => {
                const isWeekend = day.getDay() === 0 || day.getDay() === 6
                const isToday = day.toDateString() === today.toDateString()
                return (
                  <th key={idx} className={`px-2 py-3 border-b border-gray-200 text-center text-xs ${isWeekend ? 'bg-gray-50 text-gray-400' : 'bg-white text-gray-600'} ${isToday ? 'bg-yellow-50 border-x-yellow-200' : ''}`}>
                    <div className="flex flex-col items-center">
                      <span className="font-semibold">{day.getDate()}</span>
                      <span className="text-[10px]">{['日', '一', '二', '三', '四', '五', '六'][day.getDay()]}</span>
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {targetUsers.map(u => {
              const userLeaves = leaves.filter(l => l.userId === u.id)
              
              return (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-200 text-sm font-medium text-gray-900 shadow-[1px_0_0_0_#e5e7eb] group-hover:bg-gray-50">
                    <div className="flex flex-col">
                      <span>{u.name}</span>
                      <span className="text-[10px] text-gray-400 font-normal">{u.department || '未設定'}</span>
                    </div>
                  </td>
                  
                  {days.map((day, idx) => {
                    const isWeekend = day.getDay() === 0 || day.getDay() === 6
                    const isToday = day.toDateString() === today.toDateString()
                    
                    // Check if this user has a leave on this day
                    const leaveOnDay = userLeaves.find(l => isDateInLeave(day, l.startDate, l.endDate))
                    
                    let cellContent = null
                    let bgColorClass = isWeekend ? 'bg-gray-50' : 'bg-white'
                    
                    if (isToday && !leaveOnDay) bgColorClass = 'bg-yellow-50/30'

                    if (leaveOnDay && !isWeekend) {
                      const isPending = leaveOnDay.status === 'PENDING'
                      bgColorClass = isPending ? 'bg-yellow-100' : 'bg-[var(--brand-primary)] opacity-80'
                      
                      cellContent = (
                        <div 
                          className={`w-full h-8 rounded text-xs flex items-center justify-center cursor-help
                            ${isPending ? 'text-yellow-800 border border-yellow-200 border-dashed' : 'text-white shadow-sm'}`}
                          title={`${leaveOnDay.leaveType.name} (${leaveOnDay.partOfDay === 'ALL_DAY' ? '全天' : leaveOnDay.partOfDay === 'MORNING' ? '上半天' : '下半天'}) - ${leaveOnDay.status}`}
                        >
                          {leaveOnDay.leaveType.name.substring(0,1)}
                        </div>
                      )
                    }

                    return (
                      <td key={idx} className={`border-r border-gray-100 p-1 min-w-[40px] ${bgColorClass}`}>
                        {cellContent}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
