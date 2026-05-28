import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { getUserLeaveBalance } from "@/lib/leave-utils"
import { formatTaipeiDate, formatTaipeiDateISO, startOfYearUTC, todayStartUTCFromTaipei } from "@/lib/date-format"
import { Calendar, Info } from "lucide-react"
import Link from "next/link"
import { YearlyHeatmap } from "./components/YearlyHeatmap"
import { CancelLeaveButton } from "./components/CancelLeaveButton"
import { BalanceSummary } from "./components/BalanceSummary"
import { HistoryLedgerDrawer } from "./components/HistoryLedgerDrawer"
import { CalendarSubscribeButton } from "./components/CalendarSubscribeButton"
import { MobileLeaveActions } from "./components/MobileLeaveActions"
import { LeaveApprovalSteps } from "./components/LeaveApprovalSteps"

export const metadata = {
  title: "Dashboard | Timeoff",
}

export default async function DashboardPage() {
  const session = await auth()

  if (!session?.user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
        <Calendar className="w-16 h-16 text-gray-300 mb-4" />
        <h1 className="text-3xl font-bold text-gray-900">歡迎來到 PopIn 假勤系統</h1>
        <p className="mt-4 text-lg text-gray-600">請點擊右上角登入以查看您的假單</p>
      </div>
    )
  }

  const year = new Date().getFullYear()

  // Impersonate 模式：admin 以員工視角檢視時，額外顯示資料庫 id 方便除錯
  const isImpersonating = !!(session as any).impersonating

  // 銷假權限：開始日已過的假單，只有 admin（HR）能撤銷；員工/主管則隱藏按鈕（須找 HR）
  const todayStart = todayStartUTCFromTaipei()

  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
    include: { manager: true, department: { select: { name: true } } }
  })

  if (!user) return null;

  const isAdmin = user.role === "ADMIN"

  const leaveTypes = await prisma.leaveType.findMany({ where: { isActive: true } })

  const balances = await Promise.all(
    leaveTypes
      .filter(lt => !(user.gender === "MALE" && lt.name.includes("生理假")))
      .map(async (lt) => {
        const bal = await getUserLeaveBalance(user.id, lt.id)
        return { type: lt.name, ...bal }
      })
  )

  const history = await prisma.leaveRequest.findMany({
    where: {
      userId: user.id,
      status: { not: "CANCELLED" }
    },
    include: {
      leaveType: { select: { name: true, requireProof: true } },
      _count: { select: { attachments: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10
  })

  // 取得年度所有的請假供熱圖使用
  const allLeavesThisYear = await prisma.leaveRequest.findMany({
    where: {
      userId: user.id,
      status: { not: "CANCELLED" },
      startDate: {
        gte: startOfYearUTC(year),
        lt: startOfYearUTC(year + 1)
      }
    },
    select: { startDate: true, endDate: true, status: true }
  })

  // 國定假日（含補班日）：給熱圖標示平日國定假日；補班日 (isWorkDay=true) 把週六/日視為工作日
  const yearHolidays = await prisma.holiday.findMany({
    where: { date: { gte: startOfYearUTC(year), lt: startOfYearUTC(year + 1) } },
    select: { date: true, isWorkDay: true, name: true },
  })
  const holidayList = yearHolidays.map(h => ({
    date: formatTaipeiDateISO(h.date),
    isWorkDay: h.isWorkDay,
    name: h.name,
  }))

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            {user.name} 的請假紀錄表
          </h1>
          <p className="mt-2 text-gray-600">
            部門：{user.department?.name || '未設定'} | 直屬主管：{user.manager?.name || '無'}
          </p>
          {isImpersonating && (
            <p className="mt-1 inline-block text-xs font-mono text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
              User ID: {user.id}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <CalendarSubscribeButton />
          <Link
            href="/flow"
            className="btn btn-circle btn-ghost btn-sm"
            title="請假審核流程圖"
          >
            <Info className="w-5 h-5" />
          </Link>
          <Link
            href="/apply"
            className="px-6 py-2 bg-[var(--brand-primary)] text-white font-medium rounded-md shadow hover:bg-[var(--brand-primary-dark)] transition whitespace-nowrap"
          >
            申請休假
          </Link>
        </div>
      </div>

      {/* 年度熱圖 (手機版隱藏) */}
      <YearlyHeatmap leaves={allLeavesThisYear} year={year} holidays={holidayList} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

        {/* 左側：剩餘天數列表 */}
        <div className="lg:col-span-1">
          <BalanceSummary balances={balances} />
        </div>

        {/* 右側：請假紀錄 */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-100 h-full">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
              <h2 className="text-lg font-medium text-gray-900">最近休假紀錄</h2>
              <HistoryLedgerDrawer leaveTypes={
                leaveTypes
                  .filter(lt => !(user.gender === "MALE" && lt.name.includes("生理假")))
                  .map(lt => ({ id: lt.id, name: lt.name }))
              } />
            </div>
            {history.length === 0 ? (
              <div className="p-12 text-center text-gray-500 text-sm">目前尚無請假紀錄</div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-white">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">假別 / 天數</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">日期區間</th>
                    <th className="px-6 py-3 text-left font-medium text-gray-500">狀態與操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map(req => {
                    // 開始日已過的假單：只有 admin 還能銷假，員工/主管隱藏按鈕（須找 HR）
                    const canCancel =
                      (req.status === 'PENDING' || req.status === 'APPROVED') &&
                      (isAdmin || req.startDate >= todayStart)
                    return (
                    <tr key={req.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{req.leaveType.name}</div>
                        <div className="text-gray-500 text-xs">{req.durationDays} 天</div>
                        {isImpersonating && (
                          <div className="mt-1 text-[10px] font-mono text-amber-700">ID: {req.id}</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-gray-900">
                          {formatTaipeiDate(req.startDate)} - {formatTaipeiDate(req.endDate)}
                        </div>
                        <div className="text-gray-500 text-xs">
                          {req.partOfDay === 'ALL_DAY' ? '全天' : req.partOfDay === 'MORNING' ? '上半天' : '下半天'}
                        </div>
                        {req.reviewMessage && (
                          <div className={`mt-2 text-xs px-2 py-1 rounded border-l-2 max-w-xs whitespace-pre-wrap ${
                            req.status === 'REJECTED' && !req.firstApprovedAt
                              ? 'bg-[#C48F8B]/10 border-l-[#C48F8B] text-[#a36863]'
                              : 'bg-[#7A9A8A]/10 border-l-[#7A9A8A] text-[#5c7a6b]'
                          }`}>
                            <span className="font-semibold">主管留言：</span>{req.reviewMessage}
                          </div>
                        )}
                        {req.secondReviewMessage && (
                          <div className={`mt-2 text-xs px-2 py-1 rounded border-l-2 max-w-xs whitespace-pre-wrap ${
                            req.status === 'REJECTED'
                              ? 'bg-[#C48F8B]/10 border-l-[#C48F8B] text-[#a36863]'
                              : 'bg-[#7A9A8A]/10 border-l-[#7A9A8A] text-[#5c7a6b]'
                          }`}>
                            <span className="font-semibold">終審留言：</span>{req.secondReviewMessage}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full whitespace-nowrap
                            ${req.status === 'APPROVED' ? 'bg-[#7A9A8A]/20 text-[#5c7a6b]' :
                              req.status === 'PENDING' ? 'border border-[#A9ADA9] text-[#6d716f]' :
                                req.status === 'REJECTED' ? 'bg-[#C48F8B]/20 text-[#a36863]' :
                                  'bg-gray-100 text-gray-800'}`}>
                            {req.status === 'APPROVED' ? '核准' :
                              req.status === 'PENDING' ? '待審' :
                                req.status === 'REJECTED' ? '駁回' :
                                  req.status === 'CANCELLED' ? '銷假' : req.status}
                          </span>
                          {/* 桌機版：原本的 inline 操作；md 以下隱藏 */}
                          <div className="hidden md:flex md:items-center">
                            {req.status === 'PENDING' && (
                              <Link
                                href={`/apply?edit=${req.id}`}
                                className="ml-2 text-xs text-gray-500 hover:text-gray-700 underline"
                              >
                                修改
                              </Link>
                            )}
                            {/* 附件入口：需要證明 / 已有附件 / PENDING+APPROVED 都顯示，方便補件與檢視 */}
                            {(req.leaveType.requireProof || req._count.attachments > 0) && (
                              <Link
                                href={`/leave/${req.id}/attachments`}
                                className="ml-2 text-xs text-blue-600 hover:text-blue-800 underline"
                                title="附件管理"
                              >
                                📎 附件{req._count.attachments > 0 ? ` (${req._count.attachments})` : ""}
                              </Link>
                            )}
                            {canCancel && (
                              <CancelLeaveButton leaveId={req.id} />
                            )}
                          </div>
                          {/* 手機版：⋯ menu 收折，避免文字換行 */}
                          <div className="md:hidden ml-2">
                            <MobileLeaveActions leaveId={req.id} status={req.status} canCancel={canCancel} />
                          </div>
                        </div>
                        {/* 兩階段審核橫式進度圖：審核中一律顯示；被駁回的兩階段單也顯示（看出在哪一關被駁） */}
                        {(req.status === 'PENDING' || (req.status === 'REJECTED' && req.secondApproverId)) && (
                          <div className="mt-2">
                            <LeaveApprovalSteps
                              status={req.status}
                              firstApprovedAt={req.firstApprovedAt}
                              secondApproverId={req.secondApproverId}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
