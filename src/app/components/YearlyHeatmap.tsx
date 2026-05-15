"use client"

import { LeaveStatus } from "@prisma/client"
import ScrollContainer from 'react-indiana-drag-scroll'
import { formatTaipeiDate } from "@/lib/date-format"

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
      
      const dayLeaves = leaves.filter(leave => {
        const s = new Date(leave.startDate).setHours(0,0,0,0)
        const e = new Date(leave.endDate).setHours(0,0,0,0)
        const c = new Date(current).setHours(0,0,0,0)
        return c >= s && c <= e
      })

      if (dayLeaves.length > 0) {
        if (dayLeaves.some(l => l.status === "APPROVED")) {
          status = "APPROVED"
        } else if (dayLeaves.some(l => l.status === "PENDING")) {
          status = "PENDING"
        } else {
          status = dayLeaves[0].status
        }
      }
      days.push({ date: new Date(current), status })
      current.setDate(current.getDate() + 1)
    }
    return days
  }

  const getColor = (status: DayStatus) => {
    switch(status) {
      case "APPROVED": return "bg-[#7A9A8A]" // 莫蘭迪綠
      case "PENDING": return "bg-[#A9ADA9]" // 莫蘭迪灰
      case "REJECTED": return "bg-[#C48F8B]" // 莫蘭迪紅
      case "WEEKEND": return "bg-[#f5f6f5]" // 極淺灰
      case "NONE": return "bg-[#eaeaeb]" // 淺灰底色
      default: return "bg-transparent"
    }
  }

  return (
    <div className="hidden sm:block bg-white p-6 rounded-lg shadow border border-gray-100 mb-8 overflow-hidden">
      <ScrollContainer className="flex justify-between w-full overflow-x-auto pb-4 gap-1 select-none" hideScrollbars={false}>
        {months.map(month => {
          const days = getDaysInMonth(month)
          const firstDay = days[0].date.getDay() // 0 (Sun) to 6 (Sat)
          const padding = firstDay

          return (
            <div key={month} className="grid grid-cols-7 gap-0 h-fit border-l border-white first:border-l-0 flex-1 min-w-[60px]">
              {/* 補足月份開頭的空白 */}
              {Array.from({ length: padding }).map((_, i) => (
                <div key={`pad-${i}`} className="w-full aspect-square bg-transparent" />
              ))}
              {/* 渲染日期方格 */}
              {days.map((day, idx) => (
                <div 
                  key={idx} 
                  className={`w-full aspect-square border-[0.5px] border-white ${getColor(day.status)}`}
                  title={`${formatTaipeiDate(day.date)} - ${day.status}`}
                />
              ))}
            </div>
          )
        })}
      </ScrollContainer>

      <div className="mt-2 flex items-center gap-6 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 bg-[#eaeaeb]"></div>
          <span>一般日</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 bg-[#f5f6f5]"></div>
          <span>週末</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 bg-[#A9ADA9]"></div>
          <span>待審核</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 bg-[#7A9A8A]"></div>
          <span>已核准</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 bg-[#C48F8B]"></div>
          <span>已駁回</span>
        </div>
      </div>
    </div>
  )
}
