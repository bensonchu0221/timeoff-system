"use client"

import { useState, useTransition } from "react"
import { reviewLeave } from "@/app/actions/leave"
import toast from "react-hot-toast"
import { LeaveRequest, LeaveType, User } from "@prisma/client"
import { formatTaipeiDate } from "@/lib/date-format"

type LeaveWithRelations = LeaveRequest & {
  leaveType: LeaveType
}

export function GanttLeaveCell({
  leaveOnDay,
  isPending,
  canReview = true,
  userName,
  roundedLeft = true,
  roundedRight = true,
  extendLeft = false,
  extendRight = false,
}: {
  leaveOnDay: LeaveWithRelations,
  isPending: boolean,
  canReview?: boolean,
  userName: string,
  roundedLeft?: boolean,
  roundedRight?: boolean,
  extendLeft?: boolean,
  extendRight?: boolean,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPendingAction, startTransition] = useTransition()

  const handleReview = (status: "APPROVED" | "REJECTED") => {
    setIsOpen(false)
    startTransition(async () => {
      try {
        const res = await reviewLeave(leaveOnDay.id, status)
        if (res?.success) toast.success(`假單已${status === 'APPROVED' ? '核准' : '駁回'}`)
      } catch (err: any) {
        toast.error(err.message || "更新失敗")
      }
    })
  }

  // 莫蘭迪色系：核准用 #7A9A8A，待審核用 #A9ADA9
  const bgColorClass = isPending ? 'bg-[#A9ADA9]' : 'bg-[#7A9A8A]'

  // 圓角規則：只有假單真正端點（startDate/endDate）才用圓角；中間（含跨假日的兩側）為方角
  // 延伸規則：相鄰那格是同色塊才向外延伸 -1px 蓋過 td border；接空白格則不延伸
  const roundedClass =
    roundedLeft && roundedRight ? "rounded-md" :
    roundedLeft ? "rounded-l-md" :
    roundedRight ? "rounded-r-md" :
    ""
  const leftClass = extendLeft ? "-left-px" : "left-0"
  const rightClass = extendRight ? "-right-px" : "right-0"

  return (
    <>
      <div
        onClick={() => { if (isPending && canReview) setIsOpen(true) }}
        className={`absolute top-0 bottom-0 ${leftClass} ${rightClass} ${roundedClass} text-sm font-semibold flex items-center justify-center text-white select-none ${bgColorClass} ${isPending && canReview ? 'cursor-pointer hover:opacity-80' : ''} ${isPendingAction ? 'opacity-50 animate-pulse' : ''}`}
        title={`${leaveOnDay.leaveType.name} (${leaveOnDay.partOfDay === 'ALL_DAY' ? '全天' : leaveOnDay.partOfDay === 'MORNING' ? '上半天' : '下半天'}) - ${leaveOnDay.status}`}
      >
        {leaveOnDay.leaveType.name.substring(0,1)}
      </div>

      {isOpen && isPending && canReview && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div 
            className="bg-white rounded-lg shadow-xl border border-gray-100 p-5 max-w-sm w-full flex flex-col gap-4" 
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-gray-900">審核假單 - {userName}</h3>
            <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-md border border-gray-100">
              <p className="mb-1"><strong>假別：</strong>{leaveOnDay.leaveType.name} ({leaveOnDay.partOfDay === 'ALL_DAY' ? '全天' : leaveOnDay.partOfDay === 'MORNING' ? '上半天' : '下半天'})</p>
              <p className="mb-1"><strong>期間：</strong>{formatTaipeiDate(leaveOnDay.startDate)} ~ {formatTaipeiDate(leaveOnDay.endDate)}</p>
              <p><strong>天數：</strong>{leaveOnDay.durationDays} 天</p>
              {leaveOnDay.reason && <p className="mt-2 text-gray-500 italic">"{leaveOnDay.reason}"</p>}
            </div>
            
            <div className="flex gap-3 justify-end mt-2">
              <button 
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-md text-sm transition font-medium"
              >
                取消
              </button>
              <button 
                onClick={() => handleReview("REJECTED")}
                className="px-4 py-2 bg-[#C48F8B] text-white rounded-md text-sm hover:bg-[#b0807c] transition font-medium shadow-sm"
              >
                駁回
              </button>
              <button 
                onClick={() => handleReview("APPROVED")}
                className="px-4 py-2 bg-[#7A9A8A] text-white rounded-md text-sm hover:bg-[#6c8879] transition font-medium shadow-sm"
              >
                核准
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
