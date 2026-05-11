"use client"

import { useTransition } from "react"
import toast from "react-hot-toast"
import { createLeaveType, deleteLeaveType, updateUserTotalBalance } from "./actions"

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
    <form onSubmit={handleSubmit} className="flex gap-4 items-end mb-6 bg-gray-50 p-4 rounded-md">
      <div>
        <label className="block text-xs font-medium text-gray-700">假別名稱</label>
        <input type="text" name="name" required className="mt-1 block w-40 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" placeholder="例如：生日假" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">全域預設天數</label>
        <input type="number" step="0.5" name="defaultDays" required className="mt-1 block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" defaultValue="0" />
      </div>
      <div className="mb-2">
        <label className="inline-flex items-center text-sm">
          <input type="radio" name="isPaid" value="true" defaultChecked className="mr-1" /> 有薪
        </label>
        <label className="inline-flex items-center text-sm ml-3">
          <input type="radio" name="isPaid" value="false" className="mr-1" /> 無薪
        </label>
      </div>
      <button type="submit" disabled={isPending} className="bg-[var(--brand-primary)] text-white px-4 py-2 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition disabled:bg-gray-400">
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

export function UpdateBalanceForm({ 
  userId, 
  leaveTypeId, 
  defaultTotal, 
  remaining 
}: { 
  userId: string, 
  leaveTypeId: string, 
  defaultTotal: number, 
  remaining: number 
}) {
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)

    startTransition(async () => {
      try {
        const result = await updateUserTotalBalance(formData)
        if (result?.success) {
          toast.success(result.message)
        }
      } catch (err: any) {
        toast.error(err.message || "更新失敗")
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="leaveTypeId" value={leaveTypeId} />
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 w-16">全年總天數:</span>
        <input 
          type="number" 
          step="0.5" 
          name="totalQuota" 
          defaultValue={defaultTotal} 
          className="w-16 border border-gray-300 rounded px-1 py-0.5 text-xs text-right"
        />
        <button type="submit" disabled={isPending} className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded hover:bg-blue-200 disabled:opacity-50">
          {isPending ? "..." : "儲存"}
        </button>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-gray-500 w-16">目前可請:</span>
        <span className="text-xs font-bold text-[var(--brand-primary)]">{remaining} 天</span>
      </div>
    </form>
  )
}
