import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { getUserLeaveBalance } from "@/lib/leave-utils"
import { createLeaveType, deleteLeaveType, updateUserTotalBalance } from "./actions"

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

  const leaveTypes = await prisma.leaveType.findMany()
  const users = await prisma.user.findMany({ orderBy: { name: "asc" } })
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

      {/* 全域假別管理 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-medium mb-4">1. 全域假別管理</h2>
        
        <form action={createLeaveType} className="flex gap-4 items-end mb-6 bg-gray-50 p-4 rounded-md">
          <div>
            <label className="block text-xs font-medium text-gray-700">假別名稱</label>
            <input type="text" name="name" required className="mt-1 block w-40 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" placeholder="例如：生日假" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">全域預設天數</label>
            <input type="number" step="0.5" name="defaultDays" required className="mt-1 block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" defaultValue="0" />
          </div>
          <div className="mb-2">
            <label className="inline-flex items-center text-sm">
              <input type="radio" name="isPaid" value="true" defaultChecked className="mr-1" /> 有薪
            </label>
            <label className="inline-flex items-center text-sm ml-3">
              <input type="radio" name="isPaid" value="false" className="mr-1" /> 無薪
            </label>
          </div>
          <button type="submit" className="bg-[var(--brand-primary)] text-white px-4 py-2 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition">
            + 新增假別
          </button>
        </form>

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
                <td className="px-4 py-3">{lt.isPaid ? '✅ 有薪' : '❌ 無薪'}</td>
                <td className="px-4 py-3">
                  <form action={deleteLeaveType}>
                    <input type="hidden" name="id" value={lt.id} />
                    <button type="submit" className="text-red-500 hover:text-red-700 text-xs font-medium">刪除</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 個人額度調整 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6 overflow-x-auto">
        <h2 className="text-lg font-medium mb-4">2. 員工假數額度覆寫 ({year}年)</h2>
        <p className="text-sm text-gray-500 mb-4">
          如果您手動修改了「全年總天數」，系統會自動扣除該員工「已請天數」來算出「目前可請的剩餘天數」。
        </p>

        <table className="min-w-max w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500 sticky left-0 bg-gray-50 z-10">員工</th>
              {leaveTypes.map(lt => (
                <th key={lt.id} className="px-4 py-3 text-left font-medium text-gray-500 border-l border-gray-200 min-w-[200px]">
                  {lt.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {userBalances.map(({ user, balances }) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-4 sticky left-0 bg-white group-hover:bg-gray-50 z-10">
                  <div className="font-medium text-gray-900">{user.name || '未設定'}</div>
                  <div className="text-xs text-gray-500">{user.email}</div>
                </td>
                
                {balances.map(b => (
                  <td key={b.id} className="px-4 py-4 border-l border-gray-100">
                    <form action={updateUserTotalBalance} className="flex flex-col gap-1">
                      <input type="hidden" name="userId" value={user.id} />
                      <input type="hidden" name="leaveTypeId" value={b.id} />
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 w-16">全年總天數:</span>
                        <input 
                          type="number" 
                          step="0.5" 
                          name="totalQuota" 
                          defaultValue={b.balance.total} 
                          className="w-16 border border-gray-300 rounded px-1 py-0.5 text-xs text-right"
                        />
                        <button type="submit" className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded hover:bg-blue-200">儲存</button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500 w-16">目前可請:</span>
                        <span className="text-xs font-bold text-[var(--brand-primary)]">{b.balance.remaining} 天</span>
                      </div>
                    </form>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
