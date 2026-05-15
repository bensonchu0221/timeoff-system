// 統一以「台北時區」呈現日期，避免 server (UTC) 與 client (UTC+8) 解讀位移，
// 也讓「之前用 toISOString() 跨日寫入 DB」的歷史資料顯示回正確日期。

const TZ = "Asia/Taipei"

export function formatTaipeiDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d
  return date.toLocaleDateString("zh-TW", { timeZone: TZ })
}

// YYYY-MM-DD 形式（en-CA 在大多數環境輸出 ISO 風格日期）
export function formatTaipeiDateISO(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d
  return date.toLocaleDateString("en-CA", { timeZone: TZ })
}
