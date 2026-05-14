import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { getUserLeaveBalance } from "@/lib/leave-utils"
import { redirect } from "next/navigation"
import { LeaveForm } from "./LeaveForm"
import { BalanceSummary } from "@/app/components/BalanceSummary"

export const metadata = {
  title: "申請休假 | Timeoff",
}

export default async function ApplyLeavePage() {
  const session = await auth()
  if (!session?.user) redirect("/")

  const year = new Date().getFullYear()
  const leaveTypes = await prisma.leaveType.findMany({
    where: { isActive: true }
  })
  
  // Fetch available balances to pass to the client form for validation
  const balances = await Promise.all(
    leaveTypes.map(async (lt) => {
      const bal = await getUserLeaveBalance(session.user!.id!, lt.id, year)
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
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1)
      }
    }
  })

  // We map holidays to pass to client
  // isWorkDay = true means it's a weekend make-up day (should be selectable)
  // isWorkDay = false means it's a public holiday (should be disabled or shown differently)
  const holidayDates = holidays
    .filter(h => !h.isWorkDay)
    .map(h => h.date.toISOString())

  return (
    <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-2 space-y-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">申請休假</h1>
          <p className="mt-1 text-sm text-gray-500">
            請選擇您要請假的日期區間，系統會自動排除週末與國定假日。
          </p>
        </div>

        <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
          <LeaveForm balances={balances} holidayDates={holidayDates} />
        </div>
      </div>

      {/* 左側：剩餘天數列表 */}
      <div className="lg:col-span-1">
        <BalanceSummary balances={balances} year={year} />
      </div>
    </div>
  )
}
