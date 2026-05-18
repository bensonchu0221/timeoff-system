"use client"

import { useState, useTransition } from "react"
import toast from "react-hot-toast"
import {
  createLeaveType,
  deleteLeaveType,
  updateUserTotalBalance,
  deleteUserLeaveBalance,
  syncHolidays,
} from "./actions"

export function CreateLeaveTypeForm() {
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)

    startTransition(async () => {
      try {
        const result = await createLeaveType(formData)
        if (result?.success) {
          toast.success(result.message)
          form.reset()
        }
      } catch (err: any) {
        toast.error(err.message || "新增失敗")
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col md:flex-row md:flex-wrap md:items-end gap-3 md:gap-4 mb-6 bg-gray-50 p-4 rounded-md">
      <div className="w-full md:w-auto">
        <label className="block text-xs font-medium text-gray-700">假別名稱</label>
        <input type="text" name="name" required className="mt-1 block w-full md:w-40 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" placeholder="例如：生日假" />
      </div>
      <div className="w-full md:w-auto">
        <label className="block text-xs font-medium text-gray-700">全域預設天數</label>
        <input type="number" step="0.5" name="defaultDays" required className="mt-1 block w-full md:w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" defaultValue="0" />
      </div>
      <div className="flex items-center gap-4 md:mb-2 whitespace-nowrap">
        <label className="inline-flex items-center text-sm">
          <input type="radio" name="isPaid" value="true" defaultChecked className="mr-1" /> 有薪
        </label>
        <label className="inline-flex items-center text-sm">
          <input type="radio" name="isPaid" value="false" className="mr-1" /> 無薪
        </label>
      </div>
      <button type="submit" disabled={isPending} className="w-full md:w-auto bg-[var(--brand-primary)] text-white px-4 py-2 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition disabled:bg-gray-400">
        {isPending ? "新增中..." : "+ 新增假別"}
      </button>
    </form>
  )
}

export function DeleteLeaveTypeButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition()

  const handleDelete = () => {
    if (!confirm("確定要刪除這個假別嗎？（這不會影響過去的請假紀錄）")) return

    startTransition(async () => {
      try {
        const formData = new FormData()
        formData.append("id", id)
        const result = await deleteLeaveType(formData)
        if (result?.success) {
          toast.success(result.message)
        }
      } catch (err: any) {
        toast.error(err.message || "刪除失敗")
      }
    })
  }

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      className="text-red-500 hover:text-red-700 text-xs font-medium disabled:opacity-50"
    >
      {isPending ? "刪除中..." : "刪除"}
    </button>
  )
}

// 已存在 override 的單行編輯：顯示當前 override 值；清空按「儲存」會跳 confirm 後刪除
export function UpdateOverrideRow({
  userId,
  leaveTypeId,
  currentOverride,
  baselineWithoutOverride,
  remaining,
}: {
  userId: string
  leaveTypeId: string
  currentOverride: number
  baselineWithoutOverride: number   // 若刪除 override 後該員工會回到的基準
  remaining: number
}) {
  const [isPending, startTransition] = useTransition()
  const [value, setValue] = useState<string>(String(currentOverride))

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const trimmed = value.trim()

    if (trimmed === "") {
      // 空白 → 確認後刪除所有 override row
      if (!confirm(`移除 override 後，員工將回到基準 ${baselineWithoutOverride} 天的計算規則（特休會自動依公司前 2 年/勞基法計算）。確定刪除嗎？`)) return
      startTransition(async () => {
        try {
          const fd = new FormData()
          fd.append("userId", userId)
          fd.append("leaveTypeId", leaveTypeId)
          const result = await deleteUserLeaveBalance(fd)
          if (result?.success) toast.success(result.message)
        } catch (err: any) {
          toast.error(err.message || "刪除失敗")
        }
      })
      return
    }

    const num = Number(trimmed)
    if (isNaN(num) || num < 0) {
      toast.error("請輸入有效數字")
      return
    }

    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.append("userId", userId)
        fd.append("leaveTypeId", leaveTypeId)
        fd.append("totalQuota", String(num))
        const result = await updateUserTotalBalance(fd)
        if (result?.success) toast.success(result.message)
      } catch (err: any) {
        toast.error(err.message || "更新失敗")
      }
    })
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 w-20">Override:</span>
        <input
          type="number"
          step="0.5"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={String(baselineWithoutOverride)}
          className="w-20 border border-gray-300 rounded px-1 py-0.5 text-xs text-right"
        />
        <button
          type="submit"
          disabled={isPending}
          className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded hover:bg-blue-200 disabled:opacity-50"
        >
          {isPending ? "..." : value.trim() === "" ? "清除" : "儲存"}
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-gray-500 w-20">目前可請:</span>
        <span className="text-xs font-bold text-[var(--brand-primary)]">{remaining} 天</span>
      </div>
      <div className="text-[10px] text-gray-400">
        清除 override 後將回到基準 {baselineWithoutOverride} 天
      </div>
    </form>
  )
}

// 新增 override 表單：選員工 + 選假別 + 填天數
export function CreateOverrideForm({
  users,
  leaveTypes,
}: {
  users: { id: string; name: string | null; email: string }[]
  leaveTypes: { id: string; name: string; defaultDays: number }[]
}) {
  const [isPending, startTransition] = useTransition()
  const [userId, setUserId] = useState("")
  const [leaveTypeId, setLeaveTypeId] = useState("")
  const [totalQuota, setTotalQuota] = useState("")

  const selectedType = leaveTypes.find((lt) => lt.id === leaveTypeId)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!userId || !leaveTypeId || totalQuota.trim() === "") {
      toast.error("請填寫員工、假別與天數")
      return
    }
    const num = Number(totalQuota)
    if (isNaN(num) || num < 0) {
      toast.error("請輸入有效天數")
      return
    }
    startTransition(async () => {
      try {
        const fd = new FormData()
        fd.append("userId", userId)
        fd.append("leaveTypeId", leaveTypeId)
        fd.append("totalQuota", String(num))
        const result = await updateUserTotalBalance(fd)
        if (result?.success) {
          toast.success(result.message)
          setUserId("")
          setLeaveTypeId("")
          setTotalQuota("")
        }
      } catch (err: any) {
        toast.error(err.message || "新增失敗")
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col md:flex-row md:items-end gap-3 md:gap-4 bg-gray-50 p-4 rounded-md mb-6"
    >
      <div className="w-full md:w-auto">
        <label className="block text-xs font-medium text-gray-700">員工</label>
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          required
          className="mt-1 block w-full md:w-44 rounded-md border-gray-300 shadow-sm sm:text-sm px-3 py-2 border"
        >
          <option value="">請選擇員工</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name || u.email}
            </option>
          ))}
        </select>
      </div>
      <div className="w-full md:w-auto">
        <label className="block text-xs font-medium text-gray-700">假別</label>
        <select
          value={leaveTypeId}
          onChange={(e) => setLeaveTypeId(e.target.value)}
          required
          className="mt-1 block w-full md:w-36 rounded-md border-gray-300 shadow-sm sm:text-sm px-3 py-2 border"
        >
          <option value="">請選擇假別</option>
          {leaveTypes.map((lt) => (
            <option key={lt.id} value={lt.id}>
              {lt.name}
            </option>
          ))}
        </select>
      </div>
      <div className="w-full md:w-auto">
        <label className="block text-xs font-medium text-gray-700">Override 天數</label>
        <input
          type="number"
          step="0.5"
          value={totalQuota}
          onChange={(e) => setTotalQuota(e.target.value)}
          placeholder={selectedType ? `預設 ${selectedType.defaultDays}` : "天數"}
          className="mt-1 block w-full md:w-28 rounded-md border-gray-300 shadow-sm sm:text-sm px-3 py-2 border"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="w-full md:w-auto bg-[var(--brand-primary)] text-white px-4 py-2 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition disabled:bg-gray-400"
      >
        {isPending ? "新增中..." : "+ 新增 Override"}
      </button>
    </form>
  )
}

export function SyncHolidaysForm() {
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const year = Number(new FormData(form).get("year"))

    startTransition(async () => {
      try {
        const result = await syncHolidays(year)
        if (result?.success) {
          toast.success(result.message)
        }
      } catch (err: any) {
        toast.error(err.message || "同步失敗")
      }
    })
  }

  const currentYear = new Date().getFullYear()

  return (
    <form onSubmit={handleSubmit} className="flex gap-4 items-end bg-gray-50 p-4 rounded-md mt-6 border border-gray-100">
      <div>
        <label className="block text-xs font-medium text-gray-700">同步國定假日年份</label>
        <input
          type="number"
          name="year"
          required
          className="mt-1 block w-32 rounded-md border-gray-300 shadow-sm focus:border-[var(--brand-primary)] focus:ring-[var(--brand-primary)] sm:text-sm px-3 py-2 border"
          defaultValue={currentYear}
        />
      </div>
      <button type="submit" disabled={isPending} className="bg-[var(--brand-primary)] text-white px-4 py-2 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition disabled:bg-gray-400">
        {isPending ? "同步中..." : "開始同步"}
      </button>
      <div className="text-xs text-gray-500 ml-2 mb-2">
        從政府開放資料自動抓取該年度的國定假日與補班日
      </div>
    </form>
  )
}
