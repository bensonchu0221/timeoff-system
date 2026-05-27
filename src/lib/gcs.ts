import { Storage } from "@google-cloud/storage"

// GCS bucket 與 prefix：env 必設；於 Cloud Run 走預設 SA、於本地走 ADC
const BUCKET = process.env.GCS_BUCKET
const PREFIX = process.env.GCS_PREFIX

const storage = new Storage()

// 允許的 MIME 與大小上限；驗證在上傳前後都會跑一次
export const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const

export const MAX_FILE_BYTES = 5 * 1024 * 1024 // 5 MB
export const MAX_FILES_PER_REQUEST = 5

export function extFromMime(mime: string): string | null {
  switch (mime) {
    case "image/jpeg": return "jpg"
    case "image/png": return "png"
    case "image/webp": return "webp"
    case "application/pdf": return "pdf"
    default: return null
  }
}

// GCS 物件路徑：{prefix}/{userId}/{leaveRequestId}/{uuid}.{ext}
// userId / leaveRequestId 寫進路徑 → 後端可用 prefix match 做最後一層權限防線
export function buildObjectPath(userId: string, leaveRequestId: string, ext: string): string {
  if (!PREFIX) throw new Error("GCS_PREFIX not configured")
  const uuid = crypto.randomUUID()
  return `${PREFIX}/${userId}/${leaveRequestId}/${uuid}.${ext}`
}

interface SignedUploadParams {
  objectPath: string
  mimeType: string
  maxBytes: number
  expiresInSeconds?: number
}

// 簽發 v4 signed PUT URL；同時要求前端帶 Content-Type 與 x-goog-content-length-range
// → 即使前端被改，也無法上傳超過 maxBytes 或不同 MIME 的檔（GCS 端會拒）
export async function getSignedUploadUrl(p: SignedUploadParams) {
  if (!BUCKET) throw new Error("GCS_BUCKET not configured")
  const lengthRange = `0,${p.maxBytes}`
  const [url] = await storage
    .bucket(BUCKET)
    .file(p.objectPath)
    .getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + (p.expiresInSeconds ?? 600) * 1000,
      contentType: p.mimeType,
      extensionHeaders: {
        "x-goog-content-length-range": lengthRange,
      },
    })
  return {
    url,
    headers: {
      "Content-Type": p.mimeType,
      "x-goog-content-length-range": lengthRange,
    },
  }
}

// 簽發 v4 signed GET URL（預覽/下載用）；短效避免被截圖外流
export async function getSignedReadUrl(objectPath: string, expiresInSeconds = 300): Promise<string> {
  if (!BUCKET) throw new Error("GCS_BUCKET not configured")
  const [url] = await storage
    .bucket(BUCKET)
    .file(objectPath)
    .getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + expiresInSeconds * 1000,
    })
  return url
}

// 刪除單一 GCS 物件；ignoreNotFound 讓重複刪 / 檔案已不在時不會 throw
export async function deleteObject(objectPath: string): Promise<void> {
  if (!BUCKET) throw new Error("GCS_BUCKET not configured")
  await storage.bucket(BUCKET).file(objectPath).delete({ ignoreNotFound: true })
}

// 批次刪除 GCS 物件；個別失敗不互相影響，回傳失敗的 path 供呼叫端記錄
export async function deleteObjects(objectPaths: string[]): Promise<{ failed: string[] }> {
  const results = await Promise.allSettled(objectPaths.map((p) => deleteObject(p)))
  const failed = objectPaths.filter((_, i) => results[i].status === "rejected")
  return { failed }
}
