import { LeaveStatus } from "@prisma/client"

type DayStatus = LeaveStatus | "NONE" | "WEEKEND"

export function YearlyHeatmap({ leaves, year }: { 
  leaves: { startDate: Date, endDate: Date, status: LeaveStatus }[],
  year: number 
}) {
  const startDate = new Date(year, 0, 1)
  const endDate = new Date(year, 11, 31)

  // Generate 365/366 days
  const days: { date: Date, status: DayStatus }[] = []
  
  let current = new Date(startDate)
  while (current <= endDate) {
    let status: DayStatus = "NONE"
    
    // Check if weekend
    if (current.getDay() === 0 || current.getDay() === 6) {
      status = "WEEKEND"
    }
    
    // Overwrite if there's a leave request
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

  // Group by weeks (columns)
  const weeks: { date: Date, status: DayStatus }[][] = []
  let currentWeek: { date: Date, status: DayStatus }[] = []
  
  // Pad the first week
  const firstDayOfWeek = days[0].date.getDay()
  for (let i = 0; i < firstDayOfWeek; i++) {
    currentWeek.push({ date: new Date(0), status: "NONE" }) // dummy
  }

  for (const day of days) {
    currentWeek.push(day)
    if (currentWeek.length === 7) {
      weeks.push(currentWeek)
      currentWeek = []
    }
  }

  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push({ date: new Date(0), status: "NONE" }) // dummy pad
    }
    weeks.push(currentWeek)
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
      <div className="flex gap-1" style={{ width: 'max-content' }}>
        {weeks.map((week, wIdx) => (
          <div key={wIdx} className="flex flex-col gap-1">
            {week.map((day, dIdx) => (
              <div 
                key={dIdx} 
                className={`w-3 h-3 rounded-sm border border-white/10 ${day.date.getTime() === 0 ? 'bg-transparent border-transparent' : getColor(day.status)}`}
                title={day.date.getTime() !== 0 ? `${day.date.toLocaleDateString('zh-TW')} - ${day.status}` : ''}
              />
            ))}
          </div>
        ))}
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
