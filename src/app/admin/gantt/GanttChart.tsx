"use client"

import { useEffect, useRef } from "react"
import { DragScrollContainer } from "@/app/components/DragScrollContainer"
import { GanttLeaveCell } from "@/app/components/GanttLeaveCell"
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"

export function GanttChart({ 
  days, 
  targetUsers, 
  leaves, 
  today 
}: { 
  days: Date[], 
  targetUsers: any[], 
  leaves: any[], 
  today: Date 
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const scrollRef = useRef<any>(null)
  const todayRef = useRef<HTMLTableHeaderCellElement>(null)
  const firstOfMonthRef = useRef<HTMLTableHeaderCellElement>(null)

  useEffect(() => {
    // Scroll to 1st of month on load or month change
    if (firstOfMonthRef.current && scrollRef.current) {
      const container = scrollRef.current.getElement ? scrollRef.current.getElement() : scrollRef.current
      if (container) {
        // Find the offset of the first day of the selected month
        const firstDayPos = firstOfMonthRef.current.offsetLeft
        container.scrollLeft = firstDayPos - 212 // offset the 192px sticky column + 20px padding
      }
    } else if (todayRef.current && scrollRef.current && !searchParams.get("month")) {
      // If no month selected (viewing today's month) and 1st of month is not rendered?
      // (Wait, days always includes the 1st of the month if we are in this month)
      const container = scrollRef.current.getElement ? scrollRef.current.getElement() : scrollRef.current
      if (container) {
        const todayPos = todayRef.current.offsetLeft
        const containerWidth = container.offsetWidth
        container.scrollLeft = todayPos - containerWidth / 2
      }
    }
  }, [days, searchParams])

  const navigateMonth = (direction: number) => {
    const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    const currentMonth = searchParams.get("month") || todayStr
    const [year, month] = currentMonth.split("-").map(Number)
    const newDate = new Date(year, month - 1 + direction, 1)
    const y = newDate.getFullYear()
    const m = String(newDate.getMonth() + 1).padStart(2, '0')
    router.push(`/admin/gantt?month=${y}-${m}`)
  }

  const goToToday = () => {
    router.push(`/admin/gantt`)
  }

  const isDateInLeave = (date: Date, leaveStart: Date, leaveEnd: Date) => {
    const d = new Date(date).setHours(0,0,0,0)
    const s = new Date(leaveStart).setHours(0,0,0,0)
    const e = new Date(leaveEnd).setHours(0,0,0,0)
    return d >= s && d <= e
  }

  const currentMonthStr = searchParams.get("month") || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const currentMonthLabel = currentMonthStr

  return (
    <div className="space-y-4">
      {/* Navigation Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => navigateMonth(-1)}
            className="p-2 hover:bg-gray-100 rounded-md transition border border-gray-200 text-gray-600"
            title="上個月"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="px-4 py-2 font-bold text-gray-700 bg-gray-50 rounded-md border border-gray-200">
            {currentMonthLabel}
          </div>
          <button 
            onClick={() => navigateMonth(1)}
            className="p-2 hover:bg-gray-100 rounded-md transition border border-gray-200 text-gray-600"
            title="下個月"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={goToToday}
            className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 font-medium rounded-md hover:bg-gray-50 border border-gray-200 transition shadow-sm"
          >
            <Calendar className="w-4 h-4" />
            回今天
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200 relative">
        <DragScrollContainer className="w-full" ref={scrollRef}>
          <table className="min-w-max w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-gray-100 px-3 py-2 border-b border-r border-gray-200 text-left text-xs font-medium text-gray-600 shadow-[1px_0_0_0_#e5e7eb] w-48">
                  成員 (部門)
                </th>
                {days.map((day, idx) => {
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6
                  const isToday = day.toDateString() === today.toDateString()
                  const isFirstOfMonth = day.getDate() === 1
                  
                  const selectedMonth = currentMonthStr.split("-").map(Number)[1]
                  const isTargetFirstOfMonth = day.getDate() === 1 && (day.getMonth() + 1) === selectedMonth

                  return (
                    <th 
                      key={idx} 
                      ref={(el) => {
                        if (isToday) todayRef.current = el
                        if (isTargetFirstOfMonth) firstOfMonthRef.current = el
                      }}
                      className={`px-1 py-1 border-b border-gray-200 text-center text-xs min-w-[40px] 
                        ${isWeekend ? 'bg-gray-50 text-gray-400' : 'bg-white text-gray-600'} 
                        ${isToday ? 'bg-yellow-50 ring-2 ring-yellow-400 ring-inset z-10' : ''}
                        ${isFirstOfMonth ? 'border-l-2 border-l-gray-300' : ''}`}
                    >
                      <div className="flex flex-col items-center leading-none py-1">
                        {isFirstOfMonth && (
                          <span className="text-[8px] text-gray-400 font-bold mb-1 uppercase">
                            {day.getMonth() + 1}月
                          </span>
                        )}
                        <span className={`font-semibold text-xs ${isToday ? 'text-yellow-700' : ''}`}>{day.getDate()}</span>
                        <span className="text-[9px] mt-0.5 opacity-60">{['日', '一', '二', '三', '四', '五', '六'][day.getDay()]}</span>
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
                  <tr key={u.id} className="hover:bg-gray-50 group">
                    <td className="sticky left-0 z-20 bg-white px-3 py-2 border-r border-gray-200 text-xs text-gray-900 shadow-[1px_0_0_0_#e5e7eb] group-hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <span className="font-medium">{u.name}</span>
                        <span className="text-gray-400 text-[10px]">({u.department || '未設定'})</span>
                      </div>
                    </td>
                    
                    {days.map((day, idx) => {
                      const isWeekend = day.getDay() === 0 || day.getDay() === 6
                      const isToday = day.toDateString() === today.toDateString()
                      const isFirstOfMonth = day.getDate() === 1
                      
                      const leaveOnDay = userLeaves.find(l => isDateInLeave(day, l.startDate, l.endDate))
                      
                      let cellContent = null
                      let bgColorClass = isWeekend ? 'bg-gray-50/50' : 'bg-white'
                      
                      if (isToday && !leaveOnDay) bgColorClass = 'bg-yellow-50/30'
                      if (isFirstOfMonth) bgColorClass += ' border-l-2 border-l-gray-50'

                      if (leaveOnDay && !isWeekend) {
                        const isPending = leaveOnDay.status === 'PENDING'
                        cellContent = (
                          <GanttLeaveCell 
                            leaveOnDay={leaveOnDay} 
                            isPending={isPending} 
                            userName={u.name || ''} 
                          />
                        )
                      }

                      return (
                        <td key={idx} className={`border-r border-gray-100 p-0 min-w-[40px] h-9 relative ${bgColorClass} ${isToday ? 'after:content-[""] after:absolute after:inset-0 after:border-x after:border-yellow-200/50 after:pointer-events-none' : ''}`}>
                          {cellContent}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </DragScrollContainer>
      </div>
    </div>
  )
}
