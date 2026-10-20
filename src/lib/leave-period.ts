import type { PartOfDay } from "@prisma/client"

// 假單時段：partOfDay = 開始那天的時段，endPartOfDay = 結束那天的時段。
// - 單日假：只看 partOfDay（全天 / 上半天 / 下半天），endPartOfDay 不看
// - 多天假：開始那天可「下午才開始」（AFTERNOON）、結束那天可「上午就結束」（MORNING），其餘日子都是全天
// 日期一律是 UTC 午夜表示的台北日期（與 DB / applyLeave 一致）。

export type LeaveParts = { partOfDay: PartOfDay | string; endPartOfDay?: PartOfDay | string | null }
type LeaveSpan = LeaveParts & { startDate: Date; endDate: Date }

const ymd = (d: Date) => d.toISOString().slice(0, 10)

export function isSingleDay(start: Date, end: Date): boolean {
  return ymd(start) === ymd(end)
}

// 寫入前正規化 + 驗證：單日 endPartOfDay 跟 partOfDay 一致；多天只允許「下午開始 / 上午結束」
export function normalizeParts(
  start: Date,
  end: Date,
  partOfDay: PartOfDay,
  endPartOfDay: PartOfDay | null | undefined
): { partOfDay: PartOfDay; endPartOfDay: PartOfDay } {
  if (isSingleDay(start, end)) return { partOfDay, endPartOfDay: partOfDay }
  const endPart = endPartOfDay ?? "ALL_DAY"
  if (partOfDay === "MORNING") throw new Error("多天假單的開始那天只能選「全天」或「下午才開始」")
  if (endPart === "AFTERNOON") throw new Error("多天假單的結束那天只能選「全天」或「上午就結束」")
  return { partOfDay, endPartOfDay: endPart }
}

// 某一天在這張假單裡佔哪個時段（day 不在假單範圍內時回傳 null）
export function dayPartOn(leave: LeaveSpan, day: Date): PartOfDay | null {
  const d = ymd(day)
  const s = ymd(leave.startDate)
  const e = ymd(leave.endDate)
  if (d < s || d > e) return null
  if (s === e) return leave.partOfDay as PartOfDay
  if (d === s) return leave.partOfDay as PartOfDay
  if (d === e) return (leave.endPartOfDay ?? "ALL_DAY") as PartOfDay
  return "ALL_DAY"
}

// 同一天兩個時段是否衝突：全天與任一時段衝突；上半天 + 下半天可並存
export function partsOfDayConflict(a: PartOfDay, b: PartOfDay): boolean {
  if (a === "ALL_DAY" || b === "ALL_DAY") return true
  return a === b
}

// 兩張假單是否撞期：逐一檢查重疊的每一天，任一天時段衝突即算撞期
export function leavesConflict(a: LeaveSpan, b: LeaveSpan): boolean {
  const from = ymd(a.startDate) > ymd(b.startDate) ? a.startDate : b.startDate
  const to = ymd(a.endDate) < ymd(b.endDate) ? a.endDate : b.endDate
  const day = new Date(`${ymd(from)}T00:00:00Z`)
  const last = ymd(to)
  while (ymd(day) <= last) {
    const pa = dayPartOn(a, day)
    const pb = dayPartOn(b, day)
    if (pa && pb && partsOfDayConflict(pa, pb)) return true
    day.setUTCDate(day.getUTCDate() + 1)
  }
  return false
}

const PART_LABEL: Record<string, string> = { MORNING: "上半天", AFTERNOON: "下半天" }

// 期間文字：單日「6/3 (下半天)」；多天「10/20–10/22」「10/20 下午–10/22 上午」
export function formatLeavePeriod(start: Date, end: Date, parts: LeaveParts, fmt: (d: Date) => string, sep = "–"): string {
  const s = fmt(start)
  const e = fmt(end)
  if (s === e) {
    const label = PART_LABEL[parts.partOfDay]
    return label ? `${s} (${label})` : s
  }
  const startLabel = parts.partOfDay === "AFTERNOON" ? " 下午" : ""
  const endLabel = parts.endPartOfDay === "MORNING" ? " 上午" : ""
  return `${s}${startLabel}${sep}${e}${endLabel}`
}

// 只有時段的簡短說明（列表「時段」欄用）：單日「全天 / 上半天 / 下半天」；多天「全天」「下午開始」「上午結束」「下午開始、上午結束」
export function partsLabel(start: Date, end: Date, parts: LeaveParts): string {
  if (isSingleDay(start, end)) return PART_LABEL[parts.partOfDay] ?? "全天"
  const bits: string[] = []
  if (parts.partOfDay === "AFTERNOON") bits.push("首日下午開始")
  if (parts.endPartOfDay === "MORNING") bits.push("末日上午結束")
  return bits.length ? bits.join("、") : "全天"
}
