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

// 取某年 1/1 的 UTC midnight，作為 DB 年度查詢與年度天數計算的固定基準，
// 避免 new Date(year, 0, 1) 在不同 server tz 下飄移。
export function startOfYearUTC(year: number): Date {
  return new Date(Date.UTC(year, 0, 1))
}

// 以台北時區判斷「今天」並回傳對應的 UTC midnight。
// 用於跟 DB 中 UTC midnight 的 startDate 比較。
export function todayStartUTCFromTaipei(): Date {
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: TZ })
  const [y, m, d] = todayStr.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}
