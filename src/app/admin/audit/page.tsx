import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { formatTaipeiDate } from "@/lib/date-format"
import Link from "next/link"

export const metadata = { title: "稽核日誌 | Timeoff" }

const ACTION_LABEL: Record<string, string> = {
  LEAVE_APPLY: "申請假單",
  LEAVE_APPROVE: "核准假單",
  LEAVE_REJECT: "駁回假單",
  LEAVE_CANCEL: "撤銷假單",
  LEAVE_UPDATE: "修改假單",
  USER_CREATE: "建立員工",
  USER_UPDATE_ROLE: "改角色",
  USER_UPDATE_MANAGER: "改主管",
  USER_UPDATE_HIREDATE: "改到職日",
  USER_UPDATE_GENDER: "改性別",
  USER_TERMINATE: "標記離職",
  USER_REACTIVATE: "復職",
  USER_RESET_CALENDAR_TOKEN: "重設訂閱 token",
  BALANCE_UPDATE: "改額度",
  LEAVE_TYPE_CREATE: "新增假別",
  LEAVE_TYPE_DELETE: "刪除假別",
  HOLIDAY_SYNC: "同步國定假日",
}

const PAGE_SIZE = 100

export default async function AuditPage(props: {
  searchParams: Promise<{ actorId?: string; action?: string; targetType?: string; targetId?: string }>
}) {
  const sp = await props.searchParams
  const session = await auth()
  if (!session?.user?.email) redirect("/")
  const me = await prisma.user.findUnique({ where: { email: session.user.email } })
  if (me?.role !== "ADMIN") {
    return <div className="p-6 text-red-500">權限不足：僅管理員可查看稽核日誌。</div>
  }

  const where: any = {}
  if (sp.actorId) where.actorId = sp.actorId
  if (sp.action) where.action = sp.action
  if (sp.targetType) where.targetType = sp.targetType
  if (sp.targetId) where.targetId = sp.targetId

  const [logs, totalCount, allUsers] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    prisma.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">稽核日誌</h1>
        <p className="mt-1 text-sm text-gray-500">
          所有寫操作（核准、駁回、撤銷、改員工資料、改額度等）的紀錄。最多顯示最新 {PAGE_SIZE} 筆，共 {totalCount} 筆符合條件。
        </p>
      </div>

      {/* 過濾列 */}
      <form className="flex flex-wrap gap-3 items-end mb-4 bg-white p-4 rounded-lg shadow-sm border border-gray-100">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">操作者</label>
          <select name="actorId" defaultValue={sp.actorId || ""} className="select select-bordered select-sm bg-white w-48">
            <option value="">全部</option>
            {allUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name || u.email}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">動作</label>
          <select name="action" defaultValue={sp.action || ""} className="select select-bordered select-sm bg-white w-40">
            <option value="">全部</option>
            {Object.entries(ACTION_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">目標類型</label>
          <select name="targetType" defaultValue={sp.targetType || ""} className="select select-bordered select-sm bg-white w-36">
            <option value="">全部</option>
            <option value="LeaveRequest">假單</option>
            <option value="User">員工</option>
            <option value="LeaveType">假別</option>
            <option value="UserLeaveBalance">個人額度</option>
            <option value="Holiday">國定假日</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">目標 ID</label>
          <input name="targetId" defaultValue={sp.targetId || ""} className="input input-bordered input-sm bg-white w-56 font-mono text-xs" placeholder="UUID 或複合鍵" />
        </div>
        <button type="submit" className="btn btn-sm bg-gray-700 text-white hover:bg-gray-800">查詢</button>
        <Link href="/admin/audit" className="btn btn-sm btn-ghost border border-gray-300">清除</Link>
      </form>

      <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        {logs.length === 0 ? (
          <div className="p-12 text-center text-gray-500 text-sm">沒有符合條件的紀錄</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">時間</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">操作者</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">動作</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">目標</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">內容</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600">
                    <div>{formatTaipeiDate(log.createdAt)}</div>
                    <div className="text-gray-400">{log.createdAt.toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-900">
                    {log.actor.name || log.actor.email}
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{ACTION_LABEL[log.action] || log.action}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 font-mono whitespace-nowrap">
                    <div>{log.targetType}</div>
                    <div className="text-gray-400">{log.targetId.slice(0, 8)}…</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700">
                    {log.payload ? (
                      <pre className="whitespace-pre-wrap break-all max-w-md font-mono text-[11px] bg-gray-50 p-2 rounded">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
