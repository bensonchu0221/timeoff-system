"use client"

import { useTransition } from "react"
import { forceSetAllHireDates, forceSetMaleGenders } from "./actions"
import toast from "react-hot-toast"

export function BulkActions() {
  const [isPending, startTransition] = useTransition()

  const handleBulkSetHireDate = () => {
    if (confirm("確定要將所有員工的到職日設為 2026/01/01 嗎？這將覆蓋現有的設定！")) {
      startTransition(async () => {
        try {
          const res = await forceSetAllHireDates()
          if (res?.success) toast.success(res.message)
        } catch (err: any) {
          toast.error(err.message || "更新失敗")
        }
      })
    }
  }

  const handleBulkSetGender = () => {
    if (confirm("確定要將指定員工設為男性，其餘預設為女性嗎？")) {
      startTransition(async () => {
        try {
          const res = await forceSetMaleGenders()
          if (res?.success) toast.success(res.message)
        } catch (err: any) {
          toast.error(err.message || "更新失敗")
        }
      })
    }
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={handleBulkSetHireDate}
        disabled={isPending}
        className="px-4 py-2 bg-gray-100 text-gray-700 font-medium rounded-md hover:bg-gray-200 border border-gray-300 transition shadow-sm disabled:opacity-50 text-sm"
      >
        {isPending ? "處理中..." : "批次設定到職日為 2026/01/01"}
      </button>
      
      <button
        onClick={handleBulkSetGender}
        disabled={isPending}
        className="px-4 py-2 bg-blue-50 text-blue-700 font-medium rounded-md hover:bg-blue-100 border border-blue-200 transition shadow-sm disabled:opacity-50 text-sm"
      >
        {isPending ? "處理中..." : "批次設定男性員工"}
      </button>
    </div>
  )
}
