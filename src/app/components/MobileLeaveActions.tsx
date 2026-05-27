"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { MoreVertical } from "lucide-react"
import { cancelLeave } from "@/app/actions/leave"
import toast from "react-hot-toast"

type Status = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"

// 手機版假單列表的「修改 / 銷假」收折 menu。
// 桌機（md+）走原本平鋪寫法；本元件僅在 md:hidden 容器內出現。
export function MobileLeaveActions({ leaveId, status, canCancel }: { leaveId: string; status: Status; canCancel: boolean }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const canEdit = status === "PENDING"
  if (!canEdit && !canCancel) return null

  const handleCancel = () => {
    if (!confirm("確定要銷假嗎？")) return
    setOpen(false)
    startTransition(async () => {
      try {
        const res = await cancelLeave(leaveId)
        if (res?.success) toast.success("已成功銷假！")
      } catch (err: any) {
        toast.error(err.message || "銷假失敗")
      }
    })
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="p-1.5 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-50"
        aria-label="更多操作"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <>
          {/* 點空白處關閉 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-md shadow-lg border border-gray-200 py-1 w-28 text-sm">
            {canEdit && (
              <Link
                href={`/apply?edit=${leaveId}`}
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-gray-700 hover:bg-gray-50"
              >
                修改
              </Link>
            )}
            {canCancel && (
              <button
                type="button"
                onClick={handleCancel}
                disabled={isPending}
                className="block w-full text-left px-3 py-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {isPending ? "處理中..." : "銷假"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
