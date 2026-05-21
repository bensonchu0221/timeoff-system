import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { getUserLeaveBalance } from "@/lib/leave-utils"
import { startOfYearUTC, formatTaipeiDateISO } from "@/lib/date-format"
import { redirect } from "next/navigation"
import { LeaveForm, EditTarget } from "./LeaveForm"

export const metadata = {
  title: "申請休假 | Timeoff",
}

export default async function ApplyLeavePage(props: { searchParams: Promise<{ edit?: string }> }) {
  const searchParams = await props.searchParams
  const session = await auth()
  if (!session?.user) redirect("/")

  const user = await prisma.user.findUnique({ where: { id: session.user.id! } })
  if (!user) redirect("/")

  // 修改模式：?edit={leaveRequestId}；只允許本人 + PENDING + 未過 startDate 的單
  let editTarget: EditTarget | undefined = undefined
  if (searchParams.edit) {
    const target = await prisma.leaveRequest.findUnique({ where: { id: searchParams.edit } })
    if (target && target.userId === user.id && target.status === "PENDING") {
      editTarget = {
        id: target.id,
        leaveTypeId: target.leaveTypeId,
        startDate: formatTaipeiDateISO(target.startDate),
        endDate: formatTaipeiDateISO(target.endDate),
        partOfDay: target.partOfDay,
        reason: target.reason,
        oldDuration: target.durationDays,
        backupId: target.backupId,
      }
    }
  }

  // 代理人下拉清單：在職、排除自己；顯示姓名（部門）
  const coworkers = await prisma.user.findMany({
    where: { terminatedDate: null, id: { not: user.id } },
    select: { id: true, name: true, department: { select: { name: true, sortOrder: true } } },
    orderBy: [{ department: { sortOrder: "asc" } }, { name: "asc" }],
  })

  const year = new Date().getFullYear()
  const leaveTypes = await prisma.leaveType.findMany({
    where: { isActive: true }
  })
  
  // Fetch available balances to pass to the client form for validation
  // Filter out Menstrual Leave (生理假) if the user is MALE
  const balances = await Promise.all(
    leaveTypes
      .filter(lt => !(user.gender === "MALE" && lt.name.includes("生理假")))
      .map(async (lt) => {
        const bal = await getUserLeaveBalance(user.id, lt.id)
        return { 
          id: lt.id,
          name: lt.name,
          type: lt.name,
          total: bal.total,
          used: bal.used,
          remaining: bal.remaining
        }
      })
  )

  // Fetch holidays to pass to client to highlight/disable in calendar
  const holidays = await prisma.holiday.findMany({
    where: {
      date: {
        gte: startOfYearUTC(year),
        lt: startOfYearUTC(year + 1)
      }
    }
  })

  // We map holidays to pass to client
  // isWorkDay = true means it's a weekend make-up day (should be selectable)
  // isWorkDay = false means it's a public holiday (should be disabled or shown differently)
  const holidayDates = holidays
    .filter(h => !h.isWorkDay)
    .map(h => h.date.toISOString().split('T')[0])

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{editTarget ? "修改假單" : "申請休假"}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {editTarget
            ? "您正在修改一張待審核的假單，更新後仍維持「待審核」狀態。"
            : "請選擇您要請假的日期區間，系統會自動排除週末與國定假日。"}
        </p>
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
        <LeaveForm balances={balances} holidayDates={holidayDates} editTarget={editTarget} coworkers={coworkers} />
      </div>
    </div>
  )
}
