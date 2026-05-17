"use client"

import { useState, useTransition } from "react"
import { reviewLeave, batchReviewLeave } from "@/app/actions/leave"
import { formatTaipeiDate } from "@/lib/date-format"
import toast from "react-hot-toast"

type PendingRequest = {
  id: string
  startDate: Date
  endDate: Date
  partOfDay: string
  durationDays: number
  reason: string | null
  user: { id: string; name: string | null; image: string | null; department: string | null }
  leaveType: { name: string }
}

// 單日就只秀一個日期，多日才顯示區間（與 LINE / email 通知的格式一致）
function formatLeaveRange(start: Date, end: Date): string {
  const s = formatTaipeiDate(start)
  const e = formatTaipeiDate(end)
  return s === e ? s : `${s} - ${e}`
}

function partOfDayLabel(p: string): string {
  return p === "ALL_DAY" ? "全天" : p === "MORNING" ? "上半天" : "下半天"
}

export function ApprovalsTable({ pendingRequests }: { pendingRequests: PendingRequest[] }) {
  const [isPending, startTransition] = useTransition()
  // 駁回 modal 狀態：rejectingId = "BATCH" 表示批次駁回（所有勾選的單）
  const [rejectingId, setRejectingId] = useState<string | "BATCH" | null>(null)
  const [rejectMessage, setRejectMessage] = useState("")
  // 核准 inline 留言（選填）：每張單獨立輸入
  const [approveNotes, setApproveNotes] = useState<Record<string, string>>({})
  // 批次選取
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const allIds = pendingRequests.map((r) => r.id)
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id))

  const toggleAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(allIds))
  }
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const runBatch = (status: "APPROVED" | "REJECTED", message?: string) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) {
      toast.error("請先勾選假單")
      return
    }
    startTransition(async () => {
      try {
        const res = await batchReviewLeave(ids, status, message)
        if (res.successes.length > 0) {
          toast.success(`已${status === "APPROVED" ? "核准" : "駁回"} ${res.successes.length} 張`)
        }
        if (res.failures.length > 0) {
          toast.error(`${res.failures.length} 張失敗：${res.failures.map((f) => f.error).join("；")}`, { duration: 8000 })
        }
        setSelectedIds(new Set())
        setRejectingId(null)
        setRejectMessage("")
      } catch (err: any) {
        toast.error(err.message || "批次操作失敗")
      }
    })
  }

  const runReview = (id: string, status: "APPROVED" | "REJECTED", message?: string) => {
    startTransition(async () => {
      try {
        await reviewLeave(id, status, message)
        toast.success(status === "APPROVED" ? "已核准" : "已駁回")
        if (status === "APPROVED") {
          setApproveNotes((prev) => {
            const next = { ...prev }
            delete next[id]
            return next
          })
        }
        if (status === "REJECTED") {
          setRejectingId(null)
          setRejectMessage("")
        }
      } catch (err: any) {
        toast.error(err.message || "操作失敗")
      }
    })
  }

  const submitReject = () => {
    if (!rejectingId) return
    // 理由為選填，沒填也可以送出（讓員工自己問或回看單）
    if (rejectingId === "BATCH") {
      runBatch("REJECTED", rejectMessage)
    } else {
      runReview(rejectingId, "REJECTED", rejectMessage)
    }
  }

  if (pendingRequests.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow border border-gray-200 p-12 text-center text-gray-500">
        目前沒有需要審核的假單
      </div>
    )
  }

  return (
    <>
      {/* 批次操作工具列 */}
      <div className="mb-3 flex items-center gap-3 text-sm">
        <span className="text-gray-500">
          已選 <span className="font-bold text-gray-900">{selectedIds.size}</span> / {pendingRequests.length}
        </span>
        <button
          onClick={() => runBatch("APPROVED")}
          disabled={isPending || selectedIds.size === 0}
          className="bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1 rounded-md transition disabled:opacity-50"
        >
          批次核准
        </button>
        <button
          onClick={() => {
            if (selectedIds.size === 0) {
              toast.error("請先勾選假單")
              return
            }
            setRejectingId("BATCH")
            setRejectMessage("")
          }}
          disabled={isPending || selectedIds.size === 0}
          className="bg-red-100 text-red-700 hover:bg-red-200 px-3 py-1 rounded-md transition disabled:opacity-50"
        >
          批次駁回
        </button>
      </div>

      {/* ===== 桌機表格（md 以上） ===== */}
      <div className="hidden md:block bg-white rounded-lg shadow overflow-hidden border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={isPending}
                  className="checkbox checkbox-sm"
                  title="全選 / 取消全選"
                />
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">申請人</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">假別 / 天數</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">請假區間</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">事由</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">核准留言（選填） / 操作</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {pendingRequests.map((req) => (
              <tr key={req.id} className={selectedIds.has(req.id) ? "bg-blue-50/30" : ""}>
                <td className="px-3 py-4">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(req.id)}
                    onChange={() => toggleOne(req.id)}
                    disabled={isPending}
                    className="checkbox checkbox-sm"
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    {req.user.image ? (
                      <img className="h-8 w-8 rounded-full mr-3" src={req.user.image} alt="" />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-gray-200 mr-3"></div>
                    )}
                    <div>
                      <div className="text-sm font-medium text-gray-900">{req.user.name}</div>
                      <div className="text-sm text-gray-500">{req.user.department || "未設定部門"}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{req.leaveType.name}</div>
                  <div className="text-sm text-[var(--brand-primary)] font-bold">{req.durationDays} 天</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    {formatLeaveRange(req.startDate, req.endDate)}
                  </div>
                  <div className="text-xs text-gray-500">
                    時段: {partOfDayLabel(req.partOfDay)}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-900 max-w-xs truncate" title={req.reason || ""}>
                    {req.reason || "-"}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <div className="flex items-center justify-end gap-2">
                    <input
                      type="text"
                      placeholder="留言（選填）"
                      value={approveNotes[req.id] ?? ""}
                      onChange={(e) => setApproveNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
                      disabled={isPending}
                      className="input input-bordered input-xs w-40 bg-white"
                    />
                    <button
                      onClick={() => runReview(req.id, "APPROVED", approveNotes[req.id])}
                      disabled={isPending}
                      className="bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1 rounded-md transition disabled:opacity-50"
                    >
                      核准
                    </button>
                    <button
                      onClick={() => {
                        setRejectingId(req.id)
                        setRejectMessage("")
                      }}
                      disabled={isPending}
                      className="bg-red-100 text-red-700 hover:bg-red-200 px-3 py-1 rounded-md transition disabled:opacity-50"
                    >
                      駁回
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ===== 手機卡片版（md 以下） ===== */}
      <div className="md:hidden space-y-3">
        {pendingRequests.map((req) => (
          <div
            key={req.id}
            className={`bg-white rounded-lg shadow border ${selectedIds.has(req.id) ? "border-blue-300 bg-blue-50/30" : "border-gray-200"} p-4`}
          >
            {/* 第一列：勾選 + 申請人 + 部門 */}
            <div className="flex items-center gap-3 mb-3">
              <input
                type="checkbox"
                checked={selectedIds.has(req.id)}
                onChange={() => toggleOne(req.id)}
                disabled={isPending}
                className="checkbox checkbox-sm"
              />
              {req.user.image ? (
                <img className="h-9 w-9 rounded-full" src={req.user.image} alt="" />
              ) : (
                <div className="h-9 w-9 rounded-full bg-gray-200" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{req.user.name}</div>
                <div className="text-xs text-gray-500 truncate">{req.user.department || "未設定部門"}</div>
              </div>
            </div>

            {/* 第二列：假別 / 天數 / 時段 / 區間 */}
            <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
              <div>
                <div className="text-xs text-gray-500">假別 / 天數</div>
                <div className="text-gray-900">
                  {req.leaveType.name} <span className="font-bold text-[var(--brand-primary)]">{req.durationDays} 天</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">期間 / 時段</div>
                <div className="text-gray-900">{formatLeaveRange(req.startDate, req.endDate)}</div>
                <div className="text-xs text-gray-500">{partOfDayLabel(req.partOfDay)}</div>
              </div>
            </div>

            {/* 事由 */}
            {req.reason && (
              <div className="mb-3 text-sm">
                <div className="text-xs text-gray-500 mb-1">事由</div>
                <div className="text-gray-700 whitespace-pre-wrap break-words">{req.reason}</div>
              </div>
            )}

            {/* 核准留言（選填） */}
            <input
              type="text"
              placeholder="核准留言（選填）"
              value={approveNotes[req.id] ?? ""}
              onChange={(e) => setApproveNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
              disabled={isPending}
              className="input input-bordered input-sm w-full bg-white mb-3"
            />

            {/* 操作按鈕 */}
            <div className="flex gap-2">
              <button
                onClick={() => runReview(req.id, "APPROVED", approveNotes[req.id])}
                disabled={isPending}
                className="flex-1 bg-green-100 text-green-700 hover:bg-green-200 px-3 py-2 rounded-md transition disabled:opacity-50 text-sm font-medium"
              >
                核准
              </button>
              <button
                onClick={() => {
                  setRejectingId(req.id)
                  setRejectMessage("")
                }}
                disabled={isPending}
                className="flex-1 bg-red-100 text-red-700 hover:bg-red-200 px-3 py-2 rounded-md transition disabled:opacity-50 text-sm font-medium"
              >
                駁回
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 駁回理由 modal */}
      {rejectingId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm"
          onClick={() => !isPending && setRejectingId(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl border border-gray-100 p-5 max-w-md w-full flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-gray-900">
              {rejectingId === "BATCH" ? `批次駁回 ${selectedIds.size} 張假單` : "駁回假單"}
            </h3>
            <p className="text-sm text-gray-600">
              {rejectingId === "BATCH"
                ? "以下理由將套用到所有勾選的假單（選填，若有填員工會收到通知）："
                : "駁回理由（選填，若有填員工會在通知信與系統內看到）："}
            </p>
            <textarea
              value={rejectMessage}
              onChange={(e) => setRejectMessage(e.target.value)}
              disabled={isPending}
              rows={4}
              autoFocus
              placeholder="（選填）例如：該週為部門大型發布期，請改期再申請。"
              className="textarea textarea-bordered w-full bg-white text-sm"
            />
            <div className="flex gap-3 justify-end mt-2">
              <button
                onClick={() => setRejectingId(null)}
                disabled={isPending}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-md text-sm transition font-medium"
              >
                取消
              </button>
              <button
                onClick={submitReject}
                disabled={isPending}
                className="px-4 py-2 bg-[#C48F8B] text-white rounded-md text-sm hover:bg-[#b0807c] transition font-medium shadow-sm disabled:opacity-50"
              >
                {isPending ? "送出中..." : "確認駁回"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
