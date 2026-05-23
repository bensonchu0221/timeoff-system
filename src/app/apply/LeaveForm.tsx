"use client"

import { useState, useTransition, useEffect } from "react"
import { DayPicker, DateRange } from "react-day-picker"
import { zhTW } from "date-fns/locale"
import "react-day-picker/dist/style.css"
import { PartOfDay } from "@prisma/client"
import { applyLeave, updateLeave } from "@/app/actions/leave"
import { useRouter } from "next/navigation"
import toast from "react-hot-toast"
import { AttachmentManager } from "@/app/components/AttachmentManager"

// 附件限制：與 src/lib/gcs.ts、AttachmentManager.tsx 一致（client 不能 import server-only 模組，故 local 宣告）
const ATTACH_ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const
const ATTACH_MAX_FILE_BYTES = 5 * 1024 * 1024
const ATTACH_MAX_FILES_PER_REQUEST = 5

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

type Balance = {
  id: string
  name: string
  remaining: number
  // 是否需要上傳證明文件（婚假 / 喪假等）
  requireProof: boolean
}

// 修改既有假單時傳入：表單會用這些值初始化，並改走 updateLeave
export type EditTarget = {
  id: string
  leaveTypeId: string
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
  partOfDay: PartOfDay
  reason: string | null
  oldDuration: number  // 舊的 durationDays，用於前端餘額預檢時加回
  backupId: string | null
}

// 代理人下拉選單來源
type Coworker = {
  id: string
  name: string | null
  department: { name: string } | null
}

// 將後端傳入的 YYYY-MM-DD 字串解析為「本地時區午夜」的 Date，與 DayPicker 行為一致
function parseDateString(s: string): Date {
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export function LeaveForm({ balances, holidayDates, editTarget, coworkers }: { balances: Balance[], holidayDates: string[], editTarget?: EditTarget, coworkers: Coworker[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [range, setRange] = useState<DateRange | undefined>(
    editTarget
      ? {
          from: parseDateString(editTarget.startDate),
          to: parseDateString(editTarget.endDate),
        }
      : undefined
  )
  const [leaveTypeId, setLeaveTypeId] = useState<string>(editTarget?.leaveTypeId || balances[0]?.id || "")
  const [partOfDay, setPartOfDay] = useState<PartOfDay>(editTarget?.partOfDay || "ALL_DAY")
  const [reason, setReason] = useState(editTarget?.reason || "")
  const [backupId, setBackupId] = useState<string>(editTarget?.backupId || "")
  const [errorMsg, setErrorMsg] = useState("")
  // Modal 標題會帶具體假別名稱，例如「特休不足！」
  const [modalTitle, setModalTitle] = useState("假數不足")
  // 新申請模式：requireProof 假別可在送出時一併上傳附件（送出後再串 GCS）
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false)

  // holidayDates are now YYYY-MM-DD strings
  const publicHolidays = holidayDates.map(d => {
    // Parse as local midnight to match DayPicker's dates
    const [year, month, day] = d.split('-');
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  });

  // Custom frontend calculation for days to show user before submit
  const calculateFrontendDays = (start?: Date, end?: Date, ignorePartOfDay = false) => {
    if (!start) return 0;
    const endDate = end || start;
    let days = 0;
    const current = new Date(start);
    current.setHours(0,0,0,0);
    const target = new Date(endDate);
    target.setHours(0,0,0,0);

    while (current <= target) {
      const isWeekend = current.getDay() === 0 || current.getDay() === 6;
      // Compare by date string to avoid timezone mismatch
      const currentDateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      const isHoliday = holidayDates.includes(currentDateStr);
      
      if (!isWeekend && !isHoliday) {
        days++;
      }
      current.setDate(current.getDate() + 1);
    }

    if (days === 1 && !ignorePartOfDay && partOfDay !== "ALL_DAY") {
      return 0.5;
    }
    return days;
  }

  // Calculate base days (always assuming ALL_DAY) to determine if we should show the half-day selector
  const baseDays = calculateFrontendDays(range?.from, range?.to, true);
  // Calculate actual duration (which might be 0.5) based on the user's selected partOfDay
  const duration = calculateFrontendDays(range?.from, range?.to, false);

  const selectedBalance = balances.find(b => b.id === leaveTypeId);

  const isAnnual = selectedBalance?.name.includes("特休");
  const showWarning = isAnnual && duration >= 3;

  // 多日請假時自動強制為全天；放在 effect 中避免 render 期間 setState
  useEffect(() => {
    if (duration > 1 && partOfDay !== "ALL_DAY") {
      setPartOfDay("ALL_DAY")
    }
  }, [duration, partOfDay])

  // 切換到不需證明的假別 → 清掉已選附件，避免讓使用者誤以為會跟著上傳
  useEffect(() => {
    if (!selectedBalance?.requireProof) {
      setPendingFiles([])
    }
  }, [selectedBalance?.requireProof])

  // 選檔：mime / 單檔大小 / 累計上限三道前端檢查（後端 API 還會再驗一次）
  const handlePickFiles = (filesList: FileList | null) => {
    if (!filesList || filesList.length === 0) return
    const incoming = Array.from(filesList)
    const accepted: File[] = []
    for (const f of incoming) {
      if (!(ATTACH_ALLOWED_MIMES as readonly string[]).includes(f.type)) {
        toast.error(`${f.name}：僅支援 JPG / PNG / WebP / PDF`)
        continue
      }
      if (f.size > ATTACH_MAX_FILE_BYTES) {
        toast.error(`${f.name}：檔案超過 ${ATTACH_MAX_FILE_BYTES / 1024 / 1024} MB`)
        continue
      }
      if (pendingFiles.length + accepted.length >= ATTACH_MAX_FILES_PER_REQUEST) {
        toast.error(`最多 ${ATTACH_MAX_FILES_PER_REQUEST} 個附件`)
        break
      }
      accepted.push(f)
    }
    if (accepted.length > 0) {
      setPendingFiles(prev => [...prev, ...accepted])
    }
  }

  // 送出後逐檔上傳：簽 URL → PUT GCS → 寫 DB；任一步出錯就回報該檔失敗（不阻擋其他檔）
  const uploadOneAttachment = async (file: File, leaveRequestId: string): Promise<boolean> => {
    try {
      const r1 = await fetch(`/api/leave/${leaveRequestId}/attachments/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      })
      if (!r1.ok) return false
      const { uploadUrl, headers, objectPath } = await r1.json()
      const r2 = await fetch(uploadUrl, { method: "PUT", headers, body: file })
      if (!r2.ok) return false
      const r3 = await fetch(`/api/leave/${leaveRequestId}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectPath,
          originalName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      })
      return r3.ok
    } catch {
      return false
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")

    if (!range?.from) {
      setErrorMsg("請選擇請假日期")
      return
    }

    if (duration <= 0) {
      setErrorMsg("無效的請假天數（可能全部選到假日）")
      return
    }

    // 修改模式下，舊單的天數已算在 selectedBalance.remaining 之外（屬於 pending），
    // 因此計算可用天數時要加回來；只在「同一個假別」時加回，換假別則不加
    const sameLeaveTypeAsEdit = editTarget && editTarget.leaveTypeId === leaveTypeId
    const oldDurationCredit = sameLeaveTypeAsEdit ? editTarget.oldDuration : 0

    if (selectedBalance && duration > selectedBalance.remaining + oldDurationCredit) {
      const available = selectedBalance.remaining + oldDurationCredit
      setModalTitle(`${selectedBalance.name}不足`)
      setErrorMsg(`您選了 ${duration} 天，但 ${selectedBalance.name} 目前最多只能 ${available} 天`)
      const modal = document.getElementById('insufficient_balance_modal') as HTMLDialogElement
      if (modal) modal.showModal()
      return
    }

    // 用本地年月日輸出純日期字串，避免 toISOString() 把本地 00:00 轉成 UTC 後跨日
    const toLocalDateStr = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    startTransition(async () => {
      try {
        const payload = {
          leaveTypeId,
          startDate: toLocalDateStr(range.from!),
          endDate: toLocalDateStr(range.to || range.from!),
          partOfDay,
          reason,
          backupId: backupId || null,
        }
        const result = editTarget
          ? await updateLeave(editTarget.id, payload)
          : await applyLeave(payload)

        if (result && result.error) {
          toast.error(result.error)
          setErrorMsg(result.error)
          return
        }

        // 新申請成功 + 有預選附件：逐檔丟到 GCS（假單已建立，上傳失敗不回滾，使用者可走補附件管道）
        const newRequestId: string | undefined = !editTarget ? (result as any)?.request?.id : undefined
        if (newRequestId && pendingFiles.length > 0) {
          setIsUploadingAttachments(true)
          const total = pendingFiles.length
          const toastId = toast.loading(`假單已送出，正在上傳附件 (0/${total})...`)
          const failedNames: string[] = []
          let done = 0
          for (const file of pendingFiles) {
            const ok = await uploadOneAttachment(file, newRequestId)
            done += 1
            if (!ok) failedNames.push(file.name)
            toast.loading(`假單已送出，正在上傳附件 (${done}/${total})...`, { id: toastId })
          }
          setIsUploadingAttachments(false)
          if (failedNames.length === 0) {
            toast.success(`假單已送出，${total} 個附件上傳完成`, { id: toastId })
          } else {
            toast.error(
              `假單已送出，但 ${failedNames.length} 個附件上傳失敗（${failedNames.join("、")}）。可從首頁進入該假單補上傳。`,
              { id: toastId, duration: 8000 }
            )
          }
        } else {
          toast.success(editTarget ? "假單已更新！" : "送出假單成功！")
        }

        router.push("/")
      } catch (err: any) {
        toast.error("伺服器發生未知的錯誤，請稍後再試")
        setErrorMsg("伺服器發生未知的錯誤，請稍後再試")
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-gray-200">
      {/* Left side: Calendar */}
      <div className="p-6 flex-1 flex flex-col items-center justify-center bg-gray-50/50">
        <DayPicker
          mode="range"
          selected={range}
          onSelect={setRange}
          locale={zhTW}
          numberOfMonths={2}
          fromMonth={new Date(new Date().getFullYear(), 0)}
          toMonth={new Date(new Date().getFullYear() + 1, 0)}
          fromDate={new Date(new Date().getFullYear(), 0, 1)}
          toDate={new Date(new Date().getFullYear() + 1, 0, 31)}
          disabled={[{ dayOfWeek: [0, 6] }, ...publicHolidays]}
          modifiers={{ holiday: publicHolidays }}
          modifiersStyles={{
            holiday: { color: '#ac2318', fontWeight: 'bold' }
          }}
          className="bg-white p-4 rounded-xl shadow-sm border border-gray-100"
          styles={{
            day_selected: { backgroundColor: '#7A9A8A', color: 'white' }
          }}
        />
        <div className="mt-4 space-y-1 text-center">
          <p className="text-sm text-gray-500">
            * 灰色日期為週末，紅色為國定假日（皆不計入請假天數）
          </p>
          <p className="text-xs text-gray-400">
            日曆範圍限定為 {new Date().getFullYear()} 年 1 月至 {new Date().getFullYear() + 1} 年 1 月
          </p>
        </div>
      </div>

      {/* Right side: Form Details */}
      <div className="p-6 flex-1 space-y-6">
        <fieldset className="fieldset bg-base-100 border border-base-300 p-6 rounded-box shadow-sm">
          <legend className="fieldset-legend font-bold text-lg px-2">填寫假單內容</legend>

          <label className="fieldset-label font-medium mt-2">選擇假別</label>
          <details className="dropdown w-full">
            <summary className="btn w-full justify-between bg-white border-gray-300">
              {selectedBalance ? `${selectedBalance.name} (剩餘 ${selectedBalance.remaining} 天)` : "請選擇假別"}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
            </summary>
            <ul className="menu dropdown-content bg-base-100 rounded-box z-[1] w-full p-2 shadow-xl border border-gray-100 mt-1">
              {balances.map(b => (
                <li key={b.id}>
                  <a 
                    className={b.remaining <= 0 ? "opacity-50 pointer-events-none" : ""} 
                    onClick={() => {
                      if (b.remaining > 0) setLeaveTypeId(b.id);
                      // Close dropdown
                      const details = document.querySelector('details.dropdown[open]');
                      if (details) details.removeAttribute('open');
                    }}
                  >
                    {b.name} <span className="text-xs text-gray-500 ml-auto">剩餘 {b.remaining} 天</span>
                  </a>
                </li>
              ))}
            </ul>
          </details>

          {baseDays === 1 && (
            <div className="mt-4">
              <label className="fieldset-label font-medium">時段 (僅限單日請假)</label>
              <div className="mt-2 flex gap-6 px-2">
                <label className="cursor-pointer label justify-start gap-2">
                  <input type="radio" className="radio radio-primary radio-sm" name="partOfDay" value="ALL_DAY" checked={partOfDay === "ALL_DAY"} onChange={() => setPartOfDay("ALL_DAY")} />
                  <span className="label-text">全天</span>
                </label>
                <label className="cursor-pointer label justify-start gap-2">
                  <input type="radio" className="radio radio-primary radio-sm" name="partOfDay" value="MORNING" checked={partOfDay === "MORNING"} onChange={() => setPartOfDay("MORNING")} />
                  <span className="label-text">上半天</span>
                </label>
                <label className="cursor-pointer label justify-start gap-2">
                  <input type="radio" className="radio radio-primary radio-sm" name="partOfDay" value="AFTERNOON" checked={partOfDay === "AFTERNOON"} onChange={() => setPartOfDay("AFTERNOON")} />
                  <span className="label-text">下半天</span>
                </label>
              </div>
            </div>
          )}

          <label className="fieldset-label font-medium mt-4">代理人 (選填)</label>
          <select
            value={backupId}
            onChange={(e) => setBackupId(e.target.value)}
            className="select select-bordered w-full bg-white"
          >
            <option value="">不指定代理人</option>
            {coworkers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || "(未命名)"}{c.department ? `（${c.department.name}）` : ""}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">若指定代理人，送出後該員工會收到通知。</p>

          <label className="fieldset-label font-medium mt-4">事由說明 (選填)</label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="textarea textarea-ghost w-full bg-gray-50 focus:bg-white"
            placeholder="請輸入請假事由..."
          />

          {showWarning && (
            <div role="alert" className="alert alert-warning alert-outline mt-4 bg-yellow-50/50">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
              <span>連休三天以上的年假，請先與 Connie 確定後再填寫</span>
            </div>
          )}

          {/* 新申請模式：選到需證明的假別時，提示可在下方先選檔、或於送出後從首頁補上傳 */}
          {!editTarget && selectedBalance?.requireProof && (
            <>
              <div role="alert" className="alert alert-info alert-outline mt-4 bg-blue-50/50">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span>此假別需附上證明文件，可在下方先選檔（送出時一併上傳），或於送出後從首頁假單列表「附件」補上傳。</span>
              </div>

              {/* 附件挑選區：File 物件先存在前端，送出假單成功後才實際上傳到 GCS */}
              <div className="mt-4 border border-gray-200 rounded-lg p-4 bg-gray-50/50">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-700">
                    證明文件（選填） <span className="text-gray-400">({pendingFiles.length}/{ATTACH_MAX_FILES_PER_REQUEST})</span>
                  </h3>
                  {pendingFiles.length < ATTACH_MAX_FILES_PER_REQUEST && (
                    <label className="btn btn-sm btn-outline btn-primary cursor-pointer">
                      + 選擇檔案
                      <input
                        type="file"
                        multiple
                        accept={ATTACH_ALLOWED_MIMES.join(",")}
                        className="hidden"
                        onChange={(e) => {
                          handlePickFiles(e.target.files)
                          // 清掉 input 的值，讓使用者可以重複選同一個檔
                          e.target.value = ""
                        }}
                        disabled={isPending || isUploadingAttachments}
                      />
                    </label>
                  )}
                </div>

                {pendingFiles.length === 0 ? (
                  <p className="text-xs text-gray-400 py-2 text-center">尚未選擇檔案</p>
                ) : (
                  <ul className="divide-y divide-gray-200 bg-white rounded border border-gray-200">
                    {pendingFiles.map((f, idx) => (
                      <li key={`${f.name}-${idx}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-gray-400 text-xs w-5">#{idx + 1}</span>
                            <span className="truncate font-medium" title={f.name}>{f.name}</span>
                          </div>
                          <div className="text-xs text-gray-500 ml-7">{formatBytes(f.size)}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPendingFiles(prev => prev.filter((_, i) => i !== idx))}
                          disabled={isPending || isUploadingAttachments}
                          className="btn btn-xs btn-ghost text-red-600 hover:text-red-800"
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <p className="text-xs text-gray-400 mt-2">
                  支援 JPG / PNG / WebP / PDF，單檔最大 {ATTACH_MAX_FILE_BYTES / 1024 / 1024} MB，最多 {ATTACH_MAX_FILES_PER_REQUEST} 個檔案；上傳後無法刪除。
                </p>
              </div>
            </>
          )}

          <div className="stats shadow w-full mt-6 bg-gray-50 border border-gray-100">
            <div className="stat">
              <div className="stat-title text-xs">預計扣除假別</div>
              <div className="stat-value text-lg mt-1">{selectedBalance?.name || "-"}</div>
            </div>
            
            <div className="stat text-right">
              <div className="stat-title text-xs">預計扣除總天數</div>
              <div className="stat-value text-3xl text-[var(--brand-primary)]">
                {duration} <span className="text-sm font-normal text-gray-500">天</span>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending || isUploadingAttachments || duration <= 0}
            className="btn btn-primary w-full mt-6 text-white"
          >
            {isPending || isUploadingAttachments
              ? <span className="loading loading-spinner"></span>
              : (editTarget ? "更新假單" : "送出假單")}
          </button>

          {/* 編輯模式：直接 inline 顯示附件管理（PENDING 可上傳） */}
          {editTarget && (
            <div className="mt-6">
              <AttachmentManager
                leaveRequestId={editTarget.id}
                canUpload={true}
                hint={selectedBalance?.requireProof ? "此假別需附上證明文件。" : undefined}
              />
            </div>
          )}
        </fieldset>
      </div>

      {/* DaisyUI Modal for Insufficient Balance */}
      <dialog id="insufficient_balance_modal" className="modal modal-bottom sm:modal-middle">
        <div className="modal-box">
          <h3 className="font-bold text-lg text-red-600 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {modalTitle}！
          </h3>
          <p className="py-4 text-gray-700">{errorMsg}</p>
          <div className="modal-action">
            <form method="dialog">
              <button className="btn">了解</button>
            </form>
          </div>
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </form>
  )
}
