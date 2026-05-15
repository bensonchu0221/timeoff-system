"use client"

import { useState, useTransition, useEffect } from "react"
import { DayPicker, DateRange } from "react-day-picker"
import { zhTW } from "date-fns/locale"
import "react-day-picker/dist/style.css"
import { PartOfDay } from "@prisma/client"
import { applyLeave } from "@/app/actions/leave"
import { useRouter } from "next/navigation"
import toast from "react-hot-toast"

type Balance = {
  id: string
  name: string
  remaining: number
}

export function LeaveForm({ balances, holidayDates }: { balances: Balance[], holidayDates: string[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  
  const [range, setRange] = useState<DateRange | undefined>()
  const [leaveTypeId, setLeaveTypeId] = useState<string>(balances[0]?.id || "")
  const [partOfDay, setPartOfDay] = useState<PartOfDay>("ALL_DAY")
  const [reason, setReason] = useState("")
  const [errorMsg, setErrorMsg] = useState("")

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

    if (selectedBalance && duration > selectedBalance.remaining) {
      setErrorMsg(`假數不足！您選了 ${duration} 天，但 ${selectedBalance.name} 只剩 ${selectedBalance.remaining} 天`)
      // Show daisyui modal
      const modal = document.getElementById('insufficient_balance_modal') as HTMLDialogElement
      if (modal) modal.showModal()
      return
    }

    // 用本地年月日輸出純日期字串，避免 toISOString() 把本地 00:00 轉成 UTC 後跨日
    const toLocalDateStr = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

    startTransition(async () => {
      try {
        const result = await applyLeave({
          leaveTypeId,
          startDate: toLocalDateStr(range.from!),
          endDate: toLocalDateStr(range.to || range.from!),
          partOfDay,
          reason
        })

        if (result && result.error) {
          toast.error(result.error)
          setErrorMsg(result.error)
        } else {
          toast.success("送出假單成功！")
          router.push("/")
        }
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
            disabled={isPending || duration <= 0}
            className="btn btn-primary w-full mt-6 text-white"
          >
            {isPending ? <span className="loading loading-spinner"></span> : "送出假單"}
          </button>
        </fieldset>
      </div>

      {/* DaisyUI Modal for Insufficient Balance */}
      <dialog id="insufficient_balance_modal" className="modal modal-bottom sm:modal-middle">
        <div className="modal-box">
          <h3 className="font-bold text-lg text-red-600 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            餘額不足！
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
