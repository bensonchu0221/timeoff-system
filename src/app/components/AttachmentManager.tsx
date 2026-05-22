"use client"

import { useEffect, useState, useRef } from "react"
import toast from "react-hot-toast"

// 與後端常數一致；前端先擋一輪，後端再驗一次
const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const
const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB
const MAX_FILES_PER_REQUEST = 5

type Attachment = {
  id: string
  originalName: string
  mimeType: string
  sizeBytes: number
  uploadedById: string
  createdAt: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  })
}

interface Props {
  leaveRequestId: string
  // 由父層依 status 決定：本人 + PENDING/APPROVED 才為 true
  canUpload: boolean
  // 額外提示，例如「此假別需要證明文件」
  hint?: string
}

export function AttachmentManager({ leaveRequestId, canUpload, hint }: Props) {
  const [items, setItems] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 載入列表
  const refresh = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/leave/${leaveRequestId}/attachments`)
      if (!res.ok) throw new Error("讀取附件失敗")
      const data = await res.json()
      setItems(data.items || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "讀取附件失敗"
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveRequestId])

  // 預覽：拿 signed read URL，開新分頁
  const handlePreview = async (attId: string) => {
    try {
      const res = await fetch(`/api/leave/${leaveRequestId}/attachments/${attId}`)
      if (!res.ok) throw new Error("讀取附件失敗")
      const data = await res.json()
      // 短效 URL（5 分鐘）；新分頁開啟，img/pdf 瀏覽器會直接渲染
      window.open(data.url, "_blank", "noopener,noreferrer")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "讀取附件失敗"
      toast.error(msg)
    }
  }

  // 上傳：簽 URL → PUT GCS → 通知後端寫 DB
  const handleUpload = async (file: File) => {
    if (!(ALLOWED_MIMES as readonly string[]).includes(file.type)) {
      toast.error("僅支援 JPG / PNG / WebP / PDF")
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error(`檔案不可超過 ${MAX_FILE_BYTES / 1024 / 1024} MB`)
      return
    }
    if (items.length >= MAX_FILES_PER_REQUEST) {
      toast.error(`最多 ${MAX_FILES_PER_REQUEST} 個附件`)
      return
    }

    setUploading(true)
    try {
      // 1. 跟後端拿 signed PUT URL
      const r1 = await fetch(`/api/leave/${leaveRequestId}/attachments/upload-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        }),
      })
      if (!r1.ok) {
        const err = await r1.json().catch(() => ({}))
        throw new Error(err.error || "簽 URL 失敗")
      }
      const { uploadUrl, headers, objectPath } = (await r1.json()) as {
        uploadUrl: string
        headers: Record<string, string>
        objectPath: string
      }

      // 2. PUT 到 GCS（headers 必須一字不差，否則 signature 驗不過）
      const r2 = await fetch(uploadUrl, {
        method: "PUT",
        headers,
        body: file,
      })
      if (!r2.ok) {
        throw new Error(`上傳到雲端失敗（${r2.status}）`)
      }

      // 3. 通知後端寫 DB
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
      if (!r3.ok) {
        const err = await r3.json().catch(() => ({}))
        throw new Error(err.error || "寫入紀錄失敗")
      }

      toast.success("上傳成功")
      await refresh()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "上傳失敗"
      toast.error(msg)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-gray-50/50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">
          證明文件 <span className="text-gray-400">({items.length}/{MAX_FILES_PER_REQUEST})</span>
        </h3>
        {canUpload && items.length < MAX_FILES_PER_REQUEST && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ALLOWED_MIMES.join(",")}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleUpload(f)
              }}
              disabled={uploading}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="btn btn-sm btn-outline btn-primary"
            >
              {uploading ? "上傳中..." : "+ 上傳附件"}
            </button>
          </>
        )}
      </div>

      {hint && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3">
          {hint}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-gray-400 py-4 text-center">載入中...</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">尚未上傳任何附件</p>
      ) : (
        <ul className="divide-y divide-gray-200 bg-white rounded border border-gray-200">
          {items.map((it, idx) => (
            <li key={it.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-xs w-5">#{idx + 1}</span>
                  <span className="truncate font-medium" title={it.originalName}>{it.originalName}</span>
                </div>
                <div className="text-xs text-gray-500 ml-7">
                  {formatSize(it.sizeBytes)} · 上傳於 {formatTime(it.createdAt)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => handlePreview(it.id)}
                className="btn btn-xs btn-ghost text-blue-600 hover:text-blue-800"
              >
                預覽 / 下載
              </button>
            </li>
          ))}
        </ul>
      )}

      {canUpload && (
        <p className="text-xs text-gray-400 mt-2">
          支援 JPG / PNG / WebP / PDF，單檔最大 5 MB；上傳後無法刪除（請依時間判讀補件順序）。
        </p>
      )}
    </div>
  )
}
