"use client"

import { useState, useTransition } from "react"
import { DayPicker, DateRange } from "react-day-picker"
import { zhTW } from "date-fns/locale"
import "react-day-picker/dist/style.css"
import { PartOfDay } from "@prisma/client"
import { applyLeave } from "@/app/actions/leave"
import { useRouter } from "next/navigation"

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

  const publicHolidays = holidayDates.map(d => new Date(d))

  // Custom frontend calculation for days to show user before submit
  const calculateFrontendDays = (start?: Date, end?: Date) => {
    if (!start) return 0;
    const endDate = end || start;
    let days = 0;
    const current = new Date(start);
    current.setHours(0,0,0,0);
    const target = new Date(endDate);
    target.setHours(0,0,0,0);

    while (current <= target) {
      const isWeekend = current.getDay() === 0 || current.getDay() === 6;
      const isHoliday = publicHolidays.some(h => h.getTime() === current.getTime());
      
      if (!isWeekend && !isHoliday) {
        days++;
      }
      current.setDate(current.getDate() + 1);
    }

    if (days === 1 && partOfDay !== "ALL_DAY") {
      return 0.5;
    }
    return days;
  }

  const duration = calculateFrontendDays(range?.from, range?.to);
  const selectedBalance = balances.find(b => b.id === leaveTypeId);

  // If user selects multiple days, force ALL_DAY
  if (duration > 1 && partOfDay !== "ALL_DAY") {
    setPartOfDay("ALL_DAY");
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

    if (selectedBalance && duration > selectedBalance.remaining) {
      setErrorMsg(`假數不足！您選了 ${duration} 天，但 ${selectedBalance.name} 只剩 ${selectedBalance.remaining} 天`)
      return
    }

    startTransition(async () => {
      try {
        await applyLeave({
          leaveTypeId,
          startDate: range.from!.toISOString(),
          endDate: (range.to || range.from!).toISOString(),
          partOfDay,
          reason
        })
        router.push("/")
      } catch (err: any) {
        setErrorMsg(err.message || "送出失敗，請稍後再試")
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
          disabled={[{ dayOfWeek: [0, 6] }, ...publicHolidays]}
          modifiers={{ holiday: publicHolidays }}
          modifiersStyles={{
            holiday: { color: 'red', fontWeight: 'bold' }
          }}
          className="bg-white p-4 rounded-xl shadow-sm border border-gray-100"
          styles={{
            day_selected: { backgroundColor: 'var(--brand-primary)', color: 'white' }
          }}
        />
        <p className="mt-4 text-sm text-gray-500">
          * 灰色日期為週末，紅色為國定假日（皆不計入請假天數）
        </p>
      </div>

      {/* Right side: Form Details */}
      <div className="p-6 flex-1 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700">選擇假別</label>
          <select
            value={leaveTypeId}
            onChange={(e) => setLeaveTypeId(e.target.value)}
            className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-[var(--brand-primary)] focus:border-[var(--brand-primary)] sm:text-sm rounded-md"
          >
            {balances.map(b => (
              <option key={b.id} value={b.id} disabled={b.remaining <= 0}>
                {b.name} (剩餘 {b.remaining} 天)
              </option>
            ))}
          </select>
        </div>

        {duration === 1 && (
          <div>
            <label className="block text-sm font-medium text-gray-700">時段 (僅限單日請假)</label>
            <div className="mt-2 flex gap-4">
              <label className="inline-flex items-center">
                <input type="radio" className="text-[var(--brand-primary)]" name="partOfDay" value="ALL_DAY" checked={partOfDay === "ALL_DAY"} onChange={() => setPartOfDay("ALL_DAY")} />
                <span className="ml-2">全天</span>
              </label>
              <label className="inline-flex items-center">
                <input type="radio" className="text-[var(--brand-primary)]" name="partOfDay" value="MORNING" checked={partOfDay === "MORNING"} onChange={() => setPartOfDay("MORNING")} />
                <span className="ml-2">上半天</span>
              </label>
              <label className="inline-flex items-center">
                <input type="radio" className="text-[var(--brand-primary)]" name="partOfDay" value="AFTERNOON" checked={partOfDay === "AFTERNOON"} onChange={() => setPartOfDay("AFTERNOON")} />
                <span className="ml-2">下半天</span>
              </label>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700">事由說明 (選填)</label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-[var(--brand-primary)] focus:border-[var(--brand-primary)] sm:text-sm"
            placeholder="請輸入請假事由..."
          />
        </div>

        <div className="bg-gray-50 p-4 rounded-md border border-gray-100">
          <div className="flex justify-between items-center text-lg">
            <span className="font-medium text-gray-700">預計扣除天數：</span>
            <span className="font-bold text-[var(--brand-primary)] text-2xl">{duration} 天</span>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-50 text-red-700 rounded text-sm font-medium">
            {errorMsg}
          </div>
        )}

        <button
          type="submit"
          disabled={isPending || duration <= 0}
          className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-dark)] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--brand-primary)] disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          {isPending ? "處理中..." : "送出假單"}
        </button>
      </div>
    </form>
  )
}
