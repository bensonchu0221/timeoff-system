import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { getUserLeaveBalance, getAnniversaryBaseDays, monthsBetween } from "@/lib/leave-utils"

import {
  CreateLeaveTypeForm,
  DeleteLeaveTypeButton,
  SyncHolidaysForm,
  CreateOverrideForm,
} from "./Forms"
import { BalancesTable, OverrideTableRow } from "./BalancesTable"

export const metadata = {
  title: "假別與額度設定 | Timeoff",
}

function isAnnualLeaveName(name: string): boolean {
  return name.includes("特休") || name.toLowerCase().includes("annual")
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
    orderBy: { createdAt: "asc" },
  })

  // 在職員工清單：給「新增 override」下拉用
  const activeUsers = await prisma.user.findMany({
    where: { terminatedDate: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true },
  })

  // 抓所有 override，按 (user, leaveType) 分組，每組只取最新一筆
  const allOverrides = await prisma.userLeaveBalance.findMany({
    where: { user: { terminatedDate: null }, leaveType: { isActive: true } },
    include: {
      user: { select: { id: true, name: true, email: true, hireDate: true } },
      leaveType: { select: { id: true, name: true, defaultDays: true } },
    },
  })

  const latestByPair = new Map<string, (typeof allOverrides)[number]>()
  for (const o of allOverrides) {
    const key = `${o.userId}:${o.leaveTypeId}`
    const existing = latestByPair.get(key)
    if (!existing || o.year > existing.year) latestByPair.set(key, o)
  }

  // 對每筆顯示用 row，算出「目前可請」與「移除 override 後的基準」
  const now = new Date()
  const rows: OverrideTableRow[] = await Promise.all(
    Array.from(latestByPair.values())
      .sort((a, b) => (a.user.name || "").localeCompare(b.user.name || ""))
      .map(async (o) => {
        const bal = await getUserLeaveBalance(o.userId, o.leaveTypeId, now)

        let baseline: number
        if (isAnnualLeaveName(o.leaveType.name) && o.user.hireDate) {
          // 特休：當前所在週年期、無 override 時應發的天數
          // （前 2 年走 defaultDays，滿 2 年起走勞基法 §38 表）
          const M = monthsBetween(o.user.hireDate, now)
          const currentN = Math.floor(M / 12) + 1
          baseline = getAnniversaryBaseDays(currentN, o.leaveType.defaultDays)
        } else {
          baseline = o.leaveType.defaultDays
        }

        return {
          userId: o.userId,
          leaveTypeId: o.leaveTypeId,
          userName: o.user.name,
          userEmail: o.user.email,
          leaveTypeName: o.leaveType.name,
          currentOverride: o.totalQuota,
          latestOverrideYear: o.year,
          baselineWithoutOverride: baseline,
          remaining: bal.remaining,
        }
      })
  )

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">假別與額度設定</h1>
        <p className="mt-1 text-sm text-gray-500">
          您可以在此管理全公司的假別總類，並為特定員工新增 / 調整 Override（覆寫基準額度）。
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
            {leaveTypes.map((lt) => (
              <tr key={lt.id}>
                <td className="px-4 py-3 font-medium">{lt.name}</td>
                <td className="px-4 py-3">{lt.defaultDays} 天</td>
                <td className="px-4 py-3">{lt.isPaid ? "有" : "無"}</td>
                <td className="px-4 py-3">
                  <DeleteLeaveTypeButton id={lt.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-gray-500">
          備註：「特休」假別的計算不直接使用「預設天數」，而是依「公司前 2 年 = 預設天數 / 滿 2 年後依勞基法 §38 對照表」+ override 的較大者。其他假別則直接使用預設天數。
        </p>
      </div>

      {/* 個人 override */}
      <div id="section-balances" className="bg-white rounded-lg shadow border border-gray-200 p-6 scroll-mt-32">
        <h2 className="text-lg font-medium mb-4">2. 員工 Override 列表</h2>
        <p className="text-sm text-gray-500 mb-4">
          沒有列在此處的員工，皆走「公司前 2 年 / 政府勞基法 §38」基準。若要為某員工調整額度，請使用下方「+ 新增 Override」。
        </p>

        <CreateOverrideForm
          users={activeUsers}
          leaveTypes={leaveTypes.map((lt) => ({ id: lt.id, name: lt.name, defaultDays: lt.defaultDays }))}
        />

        <BalancesTable rows={rows} />
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
