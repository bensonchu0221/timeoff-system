"use client"

import { useState, useTransition } from "react"
import { reviewLeave, batchReviewLeave } from "@/app/actions/leave"
import { formatTaipeiDate } from "@/lib/date-format"
import toast from "react-hot-toast"
import { AttachmentModalButton } from "@/app/components/AttachmentModalButton"

type PendingRequest = {
  id: string
  startDate: Date
  endDate: Date
  partOfDay: string
  durationDays: number
  reason: string | null
  user: { id: string; name: string | null; image: string | null; department: { name: string } | null }
  // 需要 requireProof 在審核 UI 標示「應備證明」
  leaveType: { name: string; requireProof: boolean }
  // 已上傳附件數；0 表示尚未上傳
  attachmentCount: number
  // 兩階段審核：目前待審階段（1=主管一審、2=Boss 二審）；isTwoStage 此單是否需二審
  stage: number
  isTwoStage: boolean
}

// 階段標籤：兩階段單顯示「一審 / 二審」；單階段不顯示
function StageBadge({ stage, isTwoStage }: { stage: number; isTwoStage: boolean }) {
  if (!isTwoStage) return null
  return stage === 2 ? (
    <span className="inline-block px-2 py-0.5 text-xs rounded-full bg-[#7A9A8A]/20 text-[#5c7a6b] font-medium">二審待終審</span>
  ) : (
    <span className="inline-block px-2 py-0.5 text-xs rounded-full border border-[#A9ADA9] text-[#6d716f] font-medium">一審</span>
  )
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
  // 單筆駁回 confirm modal
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  // 單筆核准 confirm modal
  const [approvingId, setApprovingId] = useState<string | null>(null)
  // 批次駁回 modal（保留 textarea，因為批次沒有 per-row input）
  const [batchRejectOpen, setBatchRejectOpen] = useState(false)
  const [batchRejectMessage, setBatchRejectMessage] = useState("")
  // 每列的審核留言（核准、駁回都用同一個 input）
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({})
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
        setBatchRejectOpen(false)
        setBatchRejectMessage("")
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
        setReviewNotes((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        setRejectingId(null)
        setApprovingId(null)
      } catch (err: any) {
        toast.error(err.message || "操作失敗")
      }
    })
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
            setBatchRejectOpen(true)
            setBatchRejectMessage("")
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
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">審核留言（選填） / 操作</th>
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
                      <div className="text-sm font-medium text-gray-900 flex items-center gap-2">
                        {req.user.name}
                        <StageBadge stage={req.stage} isTwoStage={req.isTwoStage} />
                      </div>
                      <div className="text-sm text-gray-500">{req.user.department?.name || "未設定部門"}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    {req.leaveType.name}
                    {/* 需要證明文件但尚未上傳 → 紅色提醒；已上傳則直接顯示附件 button */}
                    {req.leaveType.requireProof && req.attachmentCount === 0 && (
                      <span className="ml-1 text-xs text-red-600">⚠ 需附件</span>
                    )}
                  </div>
                  <div className="text-sm text-[var(--brand-primary)] font-bold">{req.durationDays} 天</div>
                  {(req.attachmentCount > 0 || req.leaveType.requireProof) && (
                    <div className="mt-1">
                      <AttachmentModalButton leaveRequestId={req.id} count={req.attachmentCount} />
                    </div>
                  )}
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
                      placeholder="審核留言（選填）"
                      value={reviewNotes[req.id] ?? ""}
                      onChange={(e) => setReviewNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
                      disabled={isPending}
                      className="input input-bordered input-xs w-40 bg-white"
                    />
                    <button
                      onClick={() => setApprovingId(req.id)}
                      disabled={isPending}
                      className="bg-green-100 text-green-700 hover:bg-green-200 px-3 py-1 rounded-md transition disabled:opacity-50"
                    >
                      核准
                    </button>
                    <button
                      onClick={() => setRejectingId(req.id)}
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
                <div className="text-sm font-medium text-gray-900 truncate flex items-center gap-2">
                  {req.user.name}
                  <StageBadge stage={req.stage} isTwoStage={req.isTwoStage} />
                </div>
                <div className="text-xs text-gray-500 truncate">{req.user.department?.name || "未設定部門"}</div>
              </div>
            </div>

            {/* 第二列：假別 / 天數 / 時段 / 區間 */}
            <div className="grid grid-cols-2 gap-2 mb-3 text-sm">
              <div>
                <div className="text-xs text-gray-500">假別 / 天數</div>
                <div className="text-gray-900">
                  {req.leaveType.name} <span className="font-bold text-[var(--brand-primary)]">{req.durationDays} 天</span>
                </div>
                {req.leaveType.requireProof && req.attachmentCount === 0 && (
                  <div className="text-xs text-red-600 mt-0.5">⚠ 需附件</div>
                )}
                {(req.attachmentCount > 0 || req.leaveType.requireProof) && (
                  <div className="mt-1">
                    <AttachmentModalButton leaveRequestId={req.id} count={req.attachmentCount} />
                  </div>
                )}
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

            {/* 審核留言（選填） */}
            <input
              type="text"
              placeholder="審核留言（選填）"
              value={reviewNotes[req.id] ?? ""}
              onChange={(e) => setReviewNotes((prev) => ({ ...prev, [req.id]: e.target.value }))}
              disabled={isPending}
              className="input input-bordered input-sm w-full bg-white mb-3"
            />

            {/* 操作按鈕 */}
            <div className="flex gap-2">
              <button
                onClick={() => setApprovingId(req.id)}
                disabled={isPending}
                className="flex-1 bg-green-100 text-green-700 hover:bg-green-200 px-3 py-2 rounded-md transition disabled:opacity-50 text-sm font-medium"
              >
                核准
              </button>
              <button
                onClick={() => setRejectingId(req.id)}
                disabled={isPending}
                className="flex-1 bg-red-100 text-red-700 hover:bg-red-200 px-3 py-2 rounded-md transition disabled:opacity-50 text-sm font-medium"
              >
                駁回
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 核准 confirm modal */}
      {approvingId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm"
          onClick={() => !isPending && setApprovingId(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl border border-gray-100 p-5 max-w-md w-full flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-gray-900">確認核准</h3>
            <p className="text-sm text-gray-600">確認要核准這張假單嗎？</p>
            {reviewNotes[approvingId] && (
              <p className="text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-md border border-gray-200">
                將附上留言：「{reviewNotes[approvingId]}」
              </p>
            )}
            <div className="flex gap-3 justify-end mt-2">
              <button
                onClick={() => setApprovingId(null)}
                disabled={isPending}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-md text-sm transition font-medium"
              >
                取消
              </button>
              <button
                onClick={() => runReview(approvingId, "APPROVED", reviewNotes[approvingId])}
                disabled={isPending}
                className="px-4 py-2 bg-[#7A9A8A] text-white rounded-md text-sm hover:bg-[#6c8879] transition font-medium shadow-sm disabled:opacity-50"
              >
                {isPending ? "送出中..." : "確認核准"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 駁回 confirm modal */}
      {rejectingId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm"
          onClick={() => !isPending && setRejectingId(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl border border-gray-100 p-5 max-w-md w-full flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-gray-900">確認駁回</h3>
            <p className="text-sm text-gray-600">確認要駁回這張假單嗎？</p>
            {reviewNotes[rejectingId] && (
              <p className="text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-md border border-gray-200">
                將附上留言：「{reviewNotes[rejectingId]}」
              </p>
            )}
            <div className="flex gap-3 justify-end mt-2">
              <button
                onClick={() => setRejectingId(null)}
                disabled={isPending}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-md text-sm transition font-medium"
              >
                取消
              </button>
              <button
                onClick={() => runReview(rejectingId, "REJECTED", reviewNotes[rejectingId])}
                disabled={isPending}
                className="px-4 py-2 bg-[#C48F8B] text-white rounded-md text-sm hover:bg-[#b0807c] transition font-medium shadow-sm disabled:opacity-50"
              >
                {isPending ? "送出中..." : "確認駁回"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批次駁回 modal（保留 textarea，因為批次無 per-row input） */}
      {batchRejectOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm"
          onClick={() => !isPending && setBatchRejectOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl border border-gray-100 p-5 max-w-md w-full flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-gray-900">
              批次駁回 {selectedIds.size} 張假單
            </h3>
            <p className="text-sm text-gray-600">
              以下理由將套用到所有勾選的假單（選填，若有填員工會收到通知）：
            </p>
            <textarea
              value={batchRejectMessage}
              onChange={(e) => setBatchRejectMessage(e.target.value)}
              disabled={isPending}
              rows={4}
              autoFocus
              placeholder="（選填）例如：該週為部門大型發布期，請改期再申請。"
              className="textarea textarea-bordered w-full bg-white text-sm"
            />
            <div className="flex gap-3 justify-end mt-2">
              <button
                onClick={() => setBatchRejectOpen(false)}
                disabled={isPending}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-md text-sm transition font-medium"
              >
                取消
              </button>
              <button
                onClick={() => runBatch("REJECTED", batchRejectMessage)}
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
