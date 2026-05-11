"use client"

import { useTransition } from "react"
import { cancelLeave } from "@/app/actions/leave"
import toast from "react-hot-toast"

export function CancelLeaveButton({ leaveId }: { leaveId: string }) {
  const [isPending, startTransition] = useTransition()

  const handleCancel = () => {
    if (!confirm("確定要撤銷這筆假單嗎？")) return

    startTransition(async () => {
      try {
        const result = await cancelLeave(leaveId)
        if (result?.success) {
          toast.success("已成功撤銷假單！")
        }
      } catch (err: any) {
        toast.error(err.message || "撤銷失敗")
      }
    })
  }

  return (
    <button
      onClick={handleCancel}
      disabled={isPending}
      className="text-sm text-red-600 hover:text-red-800 disabled:opacity-50 font-medium ml-4"
    >
      {isPending ? "撤銷中..." : "撤銷假單"}
    </button>
  )
}
