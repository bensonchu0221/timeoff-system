"use client"

import { useState } from "react"
import { AttachmentManager } from "@/app/components/AttachmentManager"

// 審核頁專用：點按鈕開 modal，內含 AttachmentManager（read-only）
// 主管 / admin 在審核中需快速確認附件，但不該離開審核頁，因此用 modal
export function AttachmentModalButton({
  leaveRequestId,
  count,
}: {
  leaveRequestId: string
  count: number
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
        title="檢視附件"
      >
        📎 附件{count > 0 ? ` (${count})` : ""}
      </button>
      {open && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
              aria-label="關閉"
            >
              ✕
            </button>
            <h3 className="font-bold text-lg mb-4">假單附件</h3>
            {/* 主管/admin 不能上傳；canUpload=false → 只看列表與預覽 */}
            <AttachmentManager leaveRequestId={leaveRequestId} canUpload={false} />
          </div>
          <div
            className="modal-backdrop"
            role="button"
            tabIndex={0}
            onClick={() => setOpen(false)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          />
        </dialog>
      )}
    </>
  )
}
