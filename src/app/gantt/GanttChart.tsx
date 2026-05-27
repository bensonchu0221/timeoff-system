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
  today,
  canReview = false,
  isAdmin = false,
}: {
  days: Date[],
  targetUsers: any[],
  leaves: any[],
  today: Date,
  canReview?: boolean,
  isAdmin?: boolean,
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const scrollRef = useRef<any>(null)
  const todayRef = useRef<HTMLTableHeaderCellElement>(null)
  const firstOfMonthRef = useRef<HTMLTableHeaderCellElement>(null)

  // 依年-月分組 days，計算每個月份佔用的天數 (colSpan)
  const monthGroups: { year: number; month: number; count: number }[] = []
  days.forEach(day => {
    const year = day.getFullYear()
    const month = day.getMonth() + 1
    const lastGroup = monthGroups[monthGroups.length - 1]
    if (lastGroup && lastGroup.year === year && lastGroup.month === month) {
      lastGroup.count++
    } else {
      monthGroups.push({ year, month, count: 1 })
    }
  })

  useEffect(() => {
    const container = scrollRef.current?.getElement ? scrollRef.current.getElement() : scrollRef.current
    if (!container) return

    const hasMonthParam = !!searchParams.get("month")

    if (!hasMonthParam && todayRef.current) {
      // 如果沒有指定月份（看當月），優先將「今天」對齊在可視區域的正中央
      const todayPos = todayRef.current.offsetLeft
      const containerWidth = container.offsetWidth
      // 左側固定欄寬度為 192px，故可視區域為 containerWidth - 192
      // 欲將今天置中於此可視區域，scrollLeft 偏移量應為今天的位置減去固定欄寬度與一半的可視區域寬度
      const visibleWidth = containerWidth - 192
      container.scrollLeft = todayPos - 192 - visibleWidth / 2
    } else if (firstOfMonthRef.current) {
      // 如果有指定月份（或今天不存在），滾動到該月 1 號
      const firstDayPos = firstOfMonthRef.current.offsetLeft
      container.scrollLeft = firstDayPos - 212 // 扣除 192px 固定欄 + 20px padding
    }
  }, [days, searchParams])

  const navigateMonth = (direction: number) => {
    const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    const currentMonth = searchParams.get("month") || todayStr
    const [year, month] = currentMonth.split("-").map(Number)
    const newDate = new Date(year, month - 1 + direction, 1)
    const y = newDate.getFullYear()
    const m = String(newDate.getMonth() + 1).padStart(2, '0')
    router.push(`/gantt?month=${y}-${m}`)
  }

  const goToToday = () => {
    router.push(`/gantt`)
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
              {/* 第一層：月份 */}
              <tr className="border-b border-gray-200">
                <th className="sticky left-0 z-20 bg-gray-100 px-3 py-2 border-r border-gray-200 text-left text-xs font-medium text-gray-600 shadow-[1px_0_0_0_#e5e7eb] w-48">
                  月份
                </th>
                {monthGroups.map((group, idx) => (
                  <th
                    key={idx}
                    colSpan={group.count}
                    className="sticky left-48 z-10 bg-gray-50 border-r border-gray-200 px-3 py-1 text-left text-xs font-bold text-gray-700 shadow-[1px_0_0_0_#e5e7eb]"
                  >
                    <span className="sticky left-[208px] inline-block whitespace-nowrap">
                      {group.year}年 {group.month}月
                    </span>
                  </th>
                ))}
              </tr>
              {/* 第二層：日期與星期 */}
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
                        ${isWeekend ? 'bg-gray-100 text-gray-500' : 'bg-white text-gray-600'} 
                        ${isToday ? 'bg-yellow-50 ring-2 ring-yellow-400 ring-inset z-10' : ''}
                        ${isFirstOfMonth ? 'border-l-2 border-l-gray-300' : ''}`}
                    >
                      <div className="flex flex-col items-center leading-none py-1">
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
                        <span className="text-gray-400 text-[10px]">({u.department?.name || '未設定'})</span>
                      </div>
                    </td>
                    
                    {days.map((day, idx) => {
                      const isWeekend = day.getDay() === 0 || day.getDay() === 6
                      const isToday = day.toDateString() === today.toDateString()
                      const isFirstOfMonth = day.getDate() === 1

                      const leaveOnDay = userLeaves.find(l => isDateInLeave(day, l.startDate, l.endDate))

                      // 圓角規則：圓角僅用於「假單真正起點/終點」；中間跨週末時仍是方角，
                      // 象徵「邏輯上還在同一張假單，只是被假日切開」
                      // 延伸規則：相鄰那格也是同色塊才向外延伸 -1px 蓋過 td border；
                      // 接到空白格時不延伸，避免色塊邊緣突出
                      let roundedLeft = true
                      let roundedRight = true
                      let extendLeft = false
                      let extendRight = false
                      if (leaveOnDay && !isWeekend) {
                        const dayMs = new Date(day).setHours(0, 0, 0, 0)
                        const startMs = new Date(leaveOnDay.startDate).setHours(0, 0, 0, 0)
                        const endMs = new Date(leaveOnDay.endDate).setHours(0, 0, 0, 0)
                        roundedLeft = dayMs <= startMs
                        roundedRight = dayMs >= endMs

                        const prevDay = new Date(day)
                        prevDay.setDate(day.getDate() - 1)
                        const prevIsWeekend = prevDay.getDay() === 0 || prevDay.getDay() === 6
                        extendLeft = !prevIsWeekend && isDateInLeave(prevDay, leaveOnDay.startDate, leaveOnDay.endDate)

                        const nextDay = new Date(day)
                        nextDay.setDate(day.getDate() + 1)
                        const nextIsWeekend = nextDay.getDay() === 0 || nextDay.getDay() === 6
                        extendRight = !nextIsWeekend && isDateInLeave(nextDay, leaveOnDay.startDate, leaveOnDay.endDate)
                      }

                      let cellContent = null
                      let bgColorClass = isWeekend ? 'bg-gray-100' : 'bg-white'

                      if (isToday && !leaveOnDay) bgColorClass = 'bg-yellow-50/30'
                      if (isFirstOfMonth) bgColorClass += ' border-l-2 border-l-gray-50'

                      if (leaveOnDay && !isWeekend) {
                        const isPending = leaveOnDay.status === 'PENDING'
                        cellContent = (
                          <GanttLeaveCell
                            leaveOnDay={leaveOnDay}
                            isPending={isPending}
                            canReview={canReview}
                            isAdmin={isAdmin}
                            userName={u.name || ''}
                            roundedLeft={roundedLeft}
                            roundedRight={roundedRight}
                            extendLeft={extendLeft}
                            extendRight={extendRight}
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
