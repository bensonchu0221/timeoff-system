import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { getUserLeaveBalance } from "@/lib/leave-utils"
import { createLeaveType, deleteLeaveType, updateUserTotalBalance } from "./actions"

import { CreateLeaveTypeForm, DeleteLeaveTypeButton, UpdateBalanceForm, SyncHolidaysForm } from "./Forms"
import { BalancesTable } from "./BalancesTable"

export const metadata = {
  title: "假別與額度設定 | Timeoff",
}

export default async function LeaveSettingsPage() {
  const session = await auth()
  if (!session?.user) redirect("/")

  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
  })

  if (!user || user.role !== "ADMIN") {
    return <div className="p-6 text-red-500">權限不足：您必須是管理員才能設定假別與額度。</div>
  }

  const leaveTypes = await prisma.leaveType.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' }
  })
  // 額度設定只列在職員工，避免畫面被歷年離職者塞滿
  const users = await prisma.user.findMany({ where: { terminatedDate: null }, orderBy: { name: "asc" } })
  const year = new Date().getFullYear()

  // 取得每個使用者的假別額度明細
  const userBalances = await Promise.all(
    users.map(async (u) => {
      const balances = await Promise.all(
        leaveTypes.map(async (lt) => {
          const bal = await getUserLeaveBalance(u.id, lt.id, year)
          return { ...lt, balance: bal }
        })
      )
      return { user: u, balances }
    })
  )

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">假別與額度設定</h1>
        <p className="mt-1 text-sm text-gray-500">
          您可以在此管理全公司的假別總類，並手動微調特定員工的可用假數。
        </p>
      </div>

      <div className="sticky top-[64px] z-20 bg-white/90 backdrop-blur-md p-3 rounded-xl shadow-sm border border-gray-200 mb-6 flex justify-center">
        <ul className="menu menu-horizontal bg-base-200 rounded-box p-1">
          <li><a href="#section-types" className="font-medium">1. 假別管理</a></li>
          <li><a href="#section-balances" className="font-medium">2. 額度覆寫</a></li>
          <li><a href="#section-sync" className="font-medium">3. 國定假日同步</a></li>
        </ul>
      </div>

      {/* 全域假別管理 */}
      <div id="section-types" className="bg-white rounded-lg shadow border border-gray-200 p-6 scroll-mt-32">
        <h2 className="text-lg font-medium mb-4">1. 全域假別管理</h2>
        
        <CreateLeaveTypeForm />

        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">假別名稱</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">預設天數</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">支薪</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {leaveTypes.map(lt => (
              <tr key={lt.id}>
                <td className="px-4 py-3 font-medium">{lt.name}</td>
                <td className="px-4 py-3">{lt.defaultDays} 天</td>
                <td className="px-4 py-3">{lt.isPaid ? '有' : '無'}</td>
                <td className="px-4 py-3">
                  <DeleteLeaveTypeButton id={lt.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 個人額度調整 */}
      <div id="section-balances" className="bg-white rounded-lg shadow border border-gray-200 p-6 scroll-mt-32">
        <h2 className="text-lg font-medium mb-4">2. 員工假數額度覆寫 ({year}年)</h2>
        <p className="text-sm text-gray-500 mb-4">
          如果您手動修改了「全年總天數」，系統會自動扣除該員工「已請天數」來算出「目前可請的剩餘天數」。
        </p>
        <BalancesTable
          leaveTypes={leaveTypes.map(lt => ({ id: lt.id, name: lt.name }))}
          userBalances={userBalances.map(({ user, balances }) => ({
            user: { id: user.id, name: user.name, email: user.email },
            balances: balances.map(b => ({ id: b.id, total: b.balance.total, remaining: b.balance.remaining })),
          }))}
        />
      </div>

      {/* 國定假日同步 */}
      <div id="section-sync" className="bg-white rounded-lg shadow border border-gray-200 p-6 scroll-mt-32">
        <h2 className="text-lg font-medium mb-4">3. 國定假日同步</h2>
        <p className="text-sm text-gray-500 mb-4">
          新的一年開始前，您可以透過此功能自動從政府開放資料庫（人事行政總處）拉取該年度的國定假日與補班日，無須手動輸入。
        </p>
        <SyncHolidaysForm />
      </div>
    </div>
  )
}
