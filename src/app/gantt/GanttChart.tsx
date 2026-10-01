"use client"

import { useEffect, useRef, useState } from "react"
import { DragScrollContainer } from "@/app/components/DragScrollContainer"
import { GanttLeaveCell } from "@/app/components/GanttLeaveCell"
import { ChevronLeft, ChevronRight, Calendar, X } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { formatTaipeiDateISO } from "@/lib/date-format"

type Holiday = { date: string; name: string; isWorkDay: boolean }

export function GanttChart({
  days,
  targetUsers,
  leaves,
  holidays = [],
  today,
  currentUserId,
  isAdmin = false,
}: {
  days: Date[],
  targetUsers: any[],
  leaves: any[],
  holidays?: Holiday[],
  today: Date,
  currentUserId: string,
  isAdmin?: boolean,
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const scrollRef = useRef<any>(null)
  const todayRef = useRef<HTMLTableHeaderCellElement>(null)
  const firstOfMonthRef = useRef<HTMLTableHeaderCellElement>(null)

  // 三個前端篩選器（條件疊加 AND）：公司、部門過濾員工列；假別過濾假單色塊。
  const [selectedCompany, setSelectedCompany] = useState("")  // "" = 全部公司
  const [selectedDept, setSelectedDept] = useState("")        // "" = 全部部門
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]) // [] = 全部假別（多選）
  const toggleType = (name: string) =>
    setSelectedTypes(prev => prev.includes(name) ? prev.filter(t => t !== name) : [...prev, name])
  const hasActiveFilter = selectedCompany !== "" || selectedDept !== "" || selectedTypes.length > 0
  // 點人名標色（可多選）：只存在這次瀏覽，重新整理即清除
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set())
  const toggleHighlight = (id: string) =>
    setHighlighted(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const clearFilters = () => { setSelectedCompany(""); setSelectedDept(""); setSelectedTypes([]) }
  // 公司代號 → 顯示名稱
  const COMPANY_LABELS: Record<string, string> = { POPIN: "博英", BROADCIEL: "鉑芯" }
  // 左側人名欄寬（px）。捲動置中計算與月份標籤的 sticky 位移都依此
  const NAME_COL = 88

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
      // 扣掉左側固定人名欄，把「今天」置中於可視區域
      const visibleWidth = containerWidth - NAME_COL
      container.scrollLeft = todayPos - NAME_COL - visibleWidth / 2
    } else if (firstOfMonthRef.current) {
      // 如果有指定月份（或今天不存在），滾動到該月 1 號
      const firstDayPos = firstOfMonthRef.current.offsetLeft
      container.scrollLeft = firstDayPos - NAME_COL - 20 // 扣除人名欄 + 20px 留白
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

  // 國定假日查表（key 用台北時區 ISO，與 server 下傳格式一致）
  const holidayMap = new Map(holidays.map(h => [h.date, h]))

  // 判斷某日的「有效工作日」狀態，與 leave-utils.calculateDurationDays 等價：
  // 國定假日(isWorkDay=false)＝非工作日（可能落在平日）；補班日(isWorkDay=true)＝週末也算工作日。
  const getDayInfo = (day: Date) => {
    const isWeekendBase = day.getDay() === 0 || day.getDay() === 6
    const h = holidayMap.get(formatTaipeiDateISO(day))
    const isMakeupWorkday = !!h && h.isWorkDay
    const isPublicHoliday = !!h && !h.isWorkDay
    const isNonWorkDay = isPublicHoliday || (isWeekendBase && !isMakeupWorkday)
    return { isNonWorkDay, isPublicHoliday, isMakeupWorkday, holidayName: h?.name }
  }

  const currentMonthStr = searchParams.get("month") || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const [labelYear, labelMonth] = currentMonthStr.split("-").map(Number)
  const currentMonthLabel = `${labelYear} 年 ${labelMonth} 月`

  // 從已載入資料動態產生篩選選項（去重）
  const companyOptions = Array.from(new Set(targetUsers.map(u => u.company).filter(Boolean)))
  const deptOptions = Array.from(new Set(targetUsers.map(u => u.department?.name ?? "未設定")))
  // 假別篩選膠囊：依後台「假別管理」的順序
  const leaveTypeOptions = Array.from(new Set(
    [...leaves].sort((a, b) => (a.leaveType.sortOrder ?? 0) - (b.leaveType.sortOrder ?? 0)).map(l => l.leaveType.name)
  ))

  // 假別篩選作用在色塊：選了假別只保留該假別的假單
  const visibleLeaves = selectedTypes.length === 0
    ? leaves
    : leaves.filter(l => selectedTypes.includes(l.leaveType.name))

  // 員工列篩選（三條件 AND）：公司、部門過濾本人；假別啟用時隱藏此窗口內無符合假單的員工
  const filteredUsers = targetUsers.filter(u => {
    if (selectedCompany && u.company !== selectedCompany) return false
    if (selectedDept && (u.department?.name ?? "未設定") !== selectedDept) return false
    if (selectedTypes.length > 0 && !visibleLeaves.some(l => l.userId === u.id)) return false
    return true
  })

  // 標色列：在格子原本底色上疊一層品牌藍，週末 / 假日的底色仍看得出來
  const HIGHLIGHT_OVERLAY = "inset 0 0 0 999px color-mix(in srgb, var(--brand-primary) 9%, transparent)"

  return (
    <div className="space-y-4">
      {/* 控制卡片：上＝月份切換，下＝篩選，中間一條分隔線 */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigateMonth(-1)}
              className="p-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]"
              title="上個月"
              aria-label="上個月"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="min-w-[8.5rem] text-center text-lg font-semibold text-gray-900 tabular-nums">
              {currentMonthLabel}
            </div>
            <button
              onClick={() => navigateMonth(1)}
              className="p-2 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]"
              title="下個月"
              aria-label="下個月"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <button
            onClick={goToToday}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[var(--brand-primary)] rounded-md border border-[var(--brand-primary)]/30 hover:bg-[var(--brand-primary)]/5 transition"
          >
            <Calendar className="w-4 h-4" />
            回今天
          </button>
        </div>

        <div className="border-t border-gray-100 px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <div className="flex items-center gap-2">
            <select
              value={selectedCompany}
              onChange={e => setSelectedCompany(e.target.value)}
              className="px-2.5 py-1.5 border border-gray-200 rounded-md text-sm bg-white hover:bg-gray-50"
              aria-label="公司"
            >
              <option value="">所有公司</option>
              {companyOptions.map(c => (
                <option key={c} value={c!}>{COMPANY_LABELS[c!] ?? c}</option>
              ))}
            </select>
            <select
              value={selectedDept}
              onChange={e => setSelectedDept(e.target.value)}
              className="px-2.5 py-1.5 border border-gray-200 rounded-md text-sm bg-white hover:bg-gray-50"
              aria-label="部門"
            >
              <option value="">所有部門</option>
              {deptOptions.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {leaveTypeOptions.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto md:flex-wrap md:overflow-visible md:border-l md:border-gray-100 md:pl-3 -mx-1 px-1 pb-0.5 md:pb-0">
              {leaveTypeOptions.map(name => {
                const active = selectedTypes.includes(name)
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleType(name)}
                    aria-pressed={active}
                    className={`shrink-0 px-2.5 py-1 rounded-full text-xs border transition ${
                      active
                        ? 'bg-[var(--brand-primary)] text-white border-[var(--brand-primary)]'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          )}

          {(hasActiveFilter || highlighted.size > 0) && (
            <div className="flex items-center gap-2 md:ml-auto">
              {highlighted.size > 0 && (
                <button
                  type="button"
                  onClick={() => setHighlighted(new Set())}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-sm text-[var(--brand-primary)] hover:bg-[var(--brand-primary)]/5 rounded-md transition"
                >
                  <X className="w-4 h-4" />
                  清除標色（{highlighted.size}）
                </button>
              )}
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md transition"
                >
                  <X className="w-4 h-4" />
                  清除篩選
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 甘特圖：固定高度、框內捲動；月份與日期兩列凍結在框頂，人名欄凍結在左側。
          isolate 讓內部 sticky 的 z-index 不會蓋過網站頂部導覽列 */}
      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200 relative isolate">
        <DragScrollContainer className="w-full overflow-auto max-h-[calc(100dvh-5.5rem)]" ref={scrollRef}>
          <table className="min-w-max w-full border-separate border-spacing-0">
            <thead>
              {/* 第一層：月份 */}
              <tr>
                <th
                  className="sticky left-0 top-0 z-30 bg-gray-100 h-7 px-2 border-b border-r border-gray-200 text-left text-[11px] font-medium text-gray-500"
                  style={{ width: NAME_COL, minWidth: NAME_COL, maxWidth: NAME_COL }}
                >
                  成員
                </th>
                {monthGroups.map((group, idx) => (
                  <th
                    key={idx}
                    colSpan={group.count}
                    className="sticky top-0 z-10 bg-gray-50 h-7 border-b border-r border-gray-200 px-2 text-left text-xs font-bold text-gray-700"
                  >
                    <span className="sticky inline-block whitespace-nowrap" style={{ left: NAME_COL + 8 }}>
                      {group.year} 年 {group.month} 月
                    </span>
                  </th>
                ))}
              </tr>
              {/* 第二層：日期與星期 */}
              <tr>
                <th
                  className="sticky left-0 top-7 z-30 bg-gray-100 border-b border-r border-gray-200"
                  style={{ width: NAME_COL, minWidth: NAME_COL, maxWidth: NAME_COL }}
                />
                {days.map((day, idx) => {
                  const { isNonWorkDay, isPublicHoliday, isMakeupWorkday, holidayName } = getDayInfo(day)
                  const isToday = day.toDateString() === today.toDateString()
                  const isFirstOfMonth = day.getDate() === 1

                  const selectedMonth = currentMonthStr.split("-").map(Number)[1]
                  const isTargetFirstOfMonth = day.getDate() === 1 && (day.getMonth() + 1) === selectedMonth

                  // 國定假日用淡紅（與週末灰區隔，平日假日也能一眼看出）；補班日呈白底工作日
                  const headerTone = isToday
                    ? 'bg-yellow-50 text-yellow-700'
                    : isPublicHoliday
                      ? 'bg-rose-50 text-rose-600'
                      : isNonWorkDay ? 'bg-gray-100 text-gray-500' : 'bg-white text-gray-600'

                  return (
                    <th
                      key={idx}
                      ref={(el) => {
                        if (isToday) todayRef.current = el
                        if (isTargetFirstOfMonth) firstOfMonthRef.current = el
                      }}
                      title={isPublicHoliday ? holidayName : isMakeupWorkday ? '補班' : undefined}
                      className={`sticky top-7 z-10 px-1 py-1 border-b border-gray-200 text-center text-xs min-w-[40px]
                        ${headerTone}
                        ${isToday ? 'shadow-[inset_0_0_0_2px_#facc15]' : ''}
                        ${isFirstOfMonth ? 'border-l-2 border-l-gray-300' : ''}`}
                    >
                      <div className="flex flex-col items-center leading-none py-1">
                        <span className="font-semibold text-xs tabular-nums">{day.getDate()}</span>
                        <span className="text-[9px] mt-0.5 opacity-60">{['日', '一', '二', '三', '四', '五', '六'][day.getDay()]}</span>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={days.length + 1} className="px-6 py-10 text-center text-sm text-gray-500">
                    無符合篩選條件的成員
                  </td>
                </tr>
              )}
              {filteredUsers.map(u => {
                const userLeaves = visibleLeaves.filter(l => l.userId === u.id)
                const isHighlighted = highlighted.has(u.id)

                return (
                  <tr key={u.id} className="group">
                    <td
                      className={`sticky left-0 z-20 border-b border-r border-gray-200 p-0 transition-colors ${
                        isHighlighted ? 'bg-[color-mix(in_srgb,var(--brand-primary)_12%,white)]' : 'bg-white group-hover:bg-gray-50'
                      }`}
                      style={{ width: NAME_COL, minWidth: NAME_COL, maxWidth: NAME_COL }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleHighlight(u.id)}
                        aria-pressed={isHighlighted}
                        title={isHighlighted ? "取消標色" : "標色這一列"}
                        className={`w-full h-9 pl-2 pr-1 text-left flex flex-col justify-center border-l-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--brand-primary)] ${
                          isHighlighted ? 'border-l-[var(--brand-primary)]' : 'border-l-transparent'
                        }`}
                      >
                        <span className="block truncate text-xs font-medium text-gray-900 leading-tight">{u.name}</span>
                        <span className="block truncate text-[9px] text-gray-400 leading-tight">{u.department?.name || '未設定'}</span>
                      </button>
                    </td>

                    {days.map((day, idx) => {
                      const { isNonWorkDay, isPublicHoliday, isMakeupWorkday, holidayName } = getDayInfo(day)
                      const isToday = day.toDateString() === today.toDateString()
                      const isFirstOfMonth = day.getDate() === 1

                      const leavesOnDay = userLeaves.filter(l => isDateInLeave(day, l.startDate, l.endDate))
                      const hasLeaveOnDay = leavesOnDay.length > 0

                      let cellContent = null
                      // 國定假日用淡紅、其餘非工作日(週末)用灰、補班日與平日白底
                      let bgColorClass = isPublicHoliday ? 'bg-rose-50' : isNonWorkDay ? 'bg-gray-100' : 'bg-white'

                      if (isToday && !hasLeaveOnDay) bgColorClass = 'bg-yellow-50/30'
                      if (isFirstOfMonth) bgColorClass += ' border-l-2 border-l-gray-50'

                      if (hasLeaveOnDay && !isNonWorkDay) {
                        // 同一天可有上半天 + 下半天兩張單；色塊元件各畫一個對角三角
                        cellContent = leavesOnDay.map(leaveOnDay => {
                          // 圓角規則：圓角僅用於「假單真正起點/終點」；中間跨非工作日（週末/國定假日）時仍是方角，
                          // 象徵「邏輯上還在同一張假單，只是被假日切開」
                          // 延伸規則：相鄰那格也是同色塊才向外延伸 -1px 蓋過 td border；
                          // 接到空白格時不延伸，避免色塊邊緣突出
                          const dayMs = new Date(day).setHours(0, 0, 0, 0)
                          const startMs = new Date(leaveOnDay.startDate).setHours(0, 0, 0, 0)
                          const endMs = new Date(leaveOnDay.endDate).setHours(0, 0, 0, 0)
                          const roundedLeft = dayMs <= startMs
                          const roundedRight = dayMs >= endMs

                          const prevDay = new Date(day)
                          prevDay.setDate(day.getDate() - 1)
                          const prevIsNonWorkDay = getDayInfo(prevDay).isNonWorkDay
                          const extendLeft = !prevIsNonWorkDay && isDateInLeave(prevDay, leaveOnDay.startDate, leaveOnDay.endDate)

                          const nextDay = new Date(day)
                          nextDay.setDate(day.getDate() + 1)
                          const nextIsNonWorkDay = getDayInfo(nextDay).isNonWorkDay
                          const extendRight = !nextIsNonWorkDay && isDateInLeave(nextDay, leaveOnDay.startDate, leaveOnDay.endDate)

                          const isPending = leaveOnDay.status === 'PENDING'
                          // 逐格審核權限與 server reviewLeaveAsUser 一致：
                          // admin 全可；否則只有「該單當前階段的指定審核者」本人可審
                          // （一審→approverId；二審→secondApproverId，即 Boss 終審者）。
                          const canReviewThis = isAdmin || (
                            isPending && (
                              leaveOnDay.firstApprovedAt == null
                                ? leaveOnDay.approverId === currentUserId
                                : leaveOnDay.secondApproverId === currentUserId
                            )
                          )
                          return (
                            <GanttLeaveCell
                              key={leaveOnDay.id}
                              leaveOnDay={leaveOnDay}
                              isPending={isPending}
                              canReview={canReviewThis}
                              isAdmin={isAdmin}
                              userName={u.name || ''}
                              roundedLeft={roundedLeft}
                              roundedRight={roundedRight}
                              extendLeft={extendLeft}
                              extendRight={extendRight}
                            />
                          )
                        })
                      }

                      return (
                        <td
                          key={idx}
                          title={!hasLeaveOnDay ? (isPublicHoliday ? holidayName : isMakeupWorkday ? '補班' : undefined) : undefined}
                          style={isHighlighted ? { boxShadow: HIGHLIGHT_OVERLAY } : undefined}
                          className={`border-b border-r border-gray-100 p-0 min-w-[40px] h-9 relative ${bgColorClass} ${isToday ? 'after:content-[""] after:absolute after:inset-0 after:border-x after:border-yellow-200/50 after:pointer-events-none' : ''}`}
                        >
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
