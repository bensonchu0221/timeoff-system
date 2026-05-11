import { LeaveStatus } from "@prisma/client"

type DayStatus = LeaveStatus | "NONE" | "WEEKEND"

export function YearlyHeatmap({ leaves, year }: { 
  leaves: { startDate: Date, endDate: Date, status: LeaveStatus }[],
  year: number 
}) {
  const months = Array.from({ length: 12 }, (_, i) => i)

  const getDaysInMonth = (month: number) => {
    const startDate = new Date(year, month, 1)
    const endDate = new Date(year, month + 1, 0)
    const days: { date: Date, status: DayStatus }[] = []
    
    let current = new Date(startDate)
    while (current <= endDate) {
      let status: DayStatus = "NONE"
      if (current.getDay() === 0 || current.getDay() === 6) {
        status = "WEEKEND"
      }
      
      for (const leave of leaves) {
        const s = new Date(leave.startDate).setHours(0,0,0,0)
        const e = new Date(leave.endDate).setHours(0,0,0,0)
        const c = new Date(current).setHours(0,0,0,0)
        if (c >= s && c <= e) {
          status = leave.status
          break
        }
      }
      days.push({ date: new Date(current), status })
      current.setDate(current.getDate() + 1)
    }
    return days
  }

  const getColor = (status: DayStatus) => {
    switch(status) {
      case "APPROVED": return "bg-green-400"
      case "PENDING": return "bg-gray-400"
      case "REJECTED": return "bg-red-400"
      case "WEEKEND": return "bg-gray-50"
      case "NONE": return "bg-gray-100"
      default: return "bg-transparent"
    }
  }

  return (
    <div className="hidden sm:block bg-white p-6 rounded-lg shadow border border-gray-100 mb-8 overflow-x-auto">
      <div className="flex gap-4" style={{ width: 'max-content' }}>
        {months.map(month => {
          const days = getDaysInMonth(month)
          const firstDay = days[0].date.getDay() // 0 (Sun) to 6 (Sat)
          // 假設以週日為第一天：
          const padding = firstDay

          return (
            <div key={month} className="grid grid-cols-7 gap-1 h-fit">
              {/* 補足月份開頭的空白 */}
              {Array.from({ length: padding }).map((_, i) => (
                <div key={`pad-${i}`} className="w-3 h-3 bg-transparent" />
              ))}
              {/* 渲染日期方格 */}
              {days.map((day, idx) => (
                <div 
                  key={idx} 
                  className={`w-3 h-3 rounded-sm border border-white/10 ${getColor(day.status)}`}
                  title={`${day.date.toLocaleDateString('zh-TW')} - ${day.status}`}
                />
              ))}
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex items-center gap-6 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gray-100"></div>
          <span>一般日</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gray-50"></div>
          <span>週末</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-gray-400"></div>
          <span>待審核</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-green-400"></div>
          <span>已核准</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-red-400"></div>
          <span>已駁回</span>
        </div>
      </div>
    </div>
  )
}
