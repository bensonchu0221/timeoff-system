import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { getUserLeaveBalance, getStatutoryAnnualDays, monthsBetween } from "@/lib/leave-utils"

import {
  CreateLeaveTypeForm,
  SyncHolidaysForm,
  CreateOverrideForm,
  CreateAdjustmentForm,
  VoidGrantButton,
} from "./Forms"
import { formatTaipeiDateISO, todayStartUTCFromTaipei } from "@/lib/date-format"
import { allowedGrantYears } from "@/lib/annual-grant-calc"
import { AnnualGrantPanel } from "./AnnualGrantPanel"
import { LeaveTypeTable } from "./LeaveTypeTable"
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
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
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

  // HR 手動調整清單（特休發放紀錄中的 ADJUSTMENT，含已作廢）
  const adjustments = await prisma.annualLeaveGrant.findMany({
    where: { kind: "ADJUSTMENT" },
    orderBy: { createdAt: "desc" },
    include: { user: { select: { name: true, email: true } }, createdBy: { select: { name: true, email: true } } },
  })

  // 特休年度發放狀態（今年、明年）
  const grantYears = allowedGrantYears(todayStartUTCFromTaipei())
  const grantStatus = await Promise.all(grantYears.map(async (year) => {
    const grantRows = await prisma.annualLeaveGrant.findMany({
      where: { periodKey: `ANNUAL:${year}`, voidedAt: null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, source: true },
    })
    return { year, count: grantRows.length, lastAt: grantRows[0]?.createdAt ?? null, lastSource: grantRows[0]?.source ?? null }
  }))

  // 對每筆顯示用 row，算出「目前可請」與「移除 override 後的基準」
  const now = new Date()
  const rows: OverrideTableRow[] = await Promise.all(
    Array.from(latestByPair.values())
      .sort((a, b) => (a.user.name || "").localeCompare(b.user.name || ""))
      .map(async (o) => {
        const bal = await getUserLeaveBalance(o.userId, o.leaveTypeId, now)

        let baseline: number
        if (isAnnualLeaveName(o.leaveType.name) && o.user.hireDate) {
          // 特休（曆年制）：今年 1/1 時依「已完整年資」應發的天數
          // 前 2 年走 defaultDays，滿 2 年起走勞基法 §38 表
          const jan1OfCurrentYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
          const completedYears = Math.floor(monthsBetween(o.user.hireDate, jan1OfCurrentYear) / 12)
          baseline = completedYears < 2
            ? o.leaveType.defaultDays
            : getStatutoryAnnualDays(completedYears)
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
          <li><a href="#section-annual-grant" className="font-medium">特休年度發放</a></li>
          <li><a href="#section-adjustments" className="font-medium">3. 手動調整</a></li>
          <li><a href="#section-sync" className="font-medium">4. 國定假日同步</a></li>
        </ul>
      </div>

      {/* 全域假別管理 */}
      <div id="section-types" className="bg-white rounded-lg shadow border border-gray-200 p-6 scroll-mt-32">
        <h2 className="text-lg font-medium mb-4">1. 全域假別管理</h2>

        <CreateLeaveTypeForm />

        {/* 拖拉左側把手調整順序；key 讓新增 / 刪除假別後重新載入列表 */}
        <LeaveTypeTable
          key={leaveTypes.map((lt) => lt.id).join(",")}
          leaveTypes={leaveTypes.map((lt) => ({ id: lt.id, name: lt.name, defaultDays: lt.defaultDays, isPaid: lt.isPaid, requireProof: lt.requireProof }))}
        />
        <p className="mt-3 text-xs text-gray-500">
          拖拉左側把手可調整假別順序，會套用到首頁額度、請假表單下拉選單（預設選第一個）、LINE 查詢與報表。
          <br />
          備註：「特休」假別的計算不直接使用「預設天數」，而是依「公司前 2 年 = 預設天數 / 滿 2 年後依勞基法 §38 對照表」+ override 的較大者。其他假別則直接使用預設天數。
        </p>
      </div>

      {/* 個人 override */}
      <div id="section-balances" className="bg-white rounded-lg shadow border border-gray-200 p-6 scroll-mt-32">
        <h2 className="text-lg font-medium mb-4">2. 員工 Override 列表</h2>
        <p className="text-sm text-gray-500 mb-4">
          沒有列在此處的員工，皆走「公司前 2 年 / 政府勞基法 §38」基準。若要為某員工調整額度，請使用下方「+ 新增 Override」。
          特休的個人年度額度只影響之後的年度發放，不會改到已發放的年度。
        </p>

        <CreateOverrideForm
          users={activeUsers}
          leaveTypes={leaveTypes.map((lt) => ({ id: lt.id, name: lt.name, defaultDays: lt.defaultDays }))}
        />

        <BalancesTable rows={rows} />
      </div>

      {/* 特休年度發放 */}
      <div id="section-annual-grant" className="bg-white rounded-lg shadow border border-gray-200 p-6 scroll-mt-32">
        <h2 className="text-lg font-medium mb-2">特休年度發放</h2>
        <p className="text-sm text-gray-500 mb-4">
          每年 12/1 系統會自動發放明年的年度特休（1/1 生效）。員工若在 12/1 前要預約明年的假，可在此提前發放全部，或到「員工管理」單人發放。已發放的人會自動略過，不會重複。
        </p>
        <AnnualGrantPanel years={grantYears} status={grantStatus} />
      </div>

      {/* HR 手動調整 */}
      <div id="section-adjustments" className="bg-white rounded-lg shadow border border-gray-200 p-6 scroll-mt-32">
        <h2 className="text-lg font-medium mb-4">3. HR 手動調整（特休補發 / 扣除）</h2>
        <p className="text-sm text-gray-500 mb-4">
          僅限特休。新人到職的首年特休、每年年度特休由系統自動發放，不需手動補。
          員工從「生效日」當天起可動用該天數；之前 balance 不含此調整。
        </p>

        <CreateAdjustmentForm users={activeUsers} />

        {adjustments.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">尚無手動調整紀錄</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">員工</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">生效日</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">數量</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">原因</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">操作人</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">建立時間</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">狀態</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {adjustments.map((adj) => (
                  <tr key={adj.id} className={adj.voidedAt ? "opacity-50" : ""}>
                    <td className="px-4 py-3 font-medium">{adj.user.name || adj.user.email}</td>
                    <td className="px-4 py-3">{formatTaipeiDateISO(adj.effectiveAt)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${adj.amount >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {adj.amount > 0 ? "+" : ""}{adj.amount}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs whitespace-pre-wrap">{adj.reason}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{adj.createdBy?.name || adj.createdBy?.email || "系統"}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatTaipeiDateISO(adj.createdAt)}</td>
                    <td className="px-4 py-3 text-xs">{adj.voidedAt ? `已作廢：${adj.voidReason}` : "有效"}</td>
                    <td className="px-4 py-3">{!adj.voidedAt && <VoidGrantButton id={adj.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 國定假日同步 */}
      <div id="section-sync" className="bg-white rounded-lg shadow border border-gray-200 p-6 scroll-mt-32">
        <h2 className="text-lg font-medium mb-4">4. 國定假日同步</h2>
        <p className="text-sm text-gray-500 mb-4">
          新的一年開始前，您可以透過此功能自動從政府開放資料庫（人事行政總處）拉取該年度的國定假日與補班日，無須手動輸入。
        </p>
        <SyncHolidaysForm />
      </div>
    </div>
  )
}
