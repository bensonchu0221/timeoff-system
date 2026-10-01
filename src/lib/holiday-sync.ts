import { prisma } from "./db"

// 國定假日 / 補班日同步（來源：ruyut/TaiwanCalendar，資料取自人事行政總處）。
// 後台「同步國定假日」按鈕與每年 9/1 排程共用。

export type TaiwanCalendarDay = { date: string; isHoliday: boolean; description?: string }
export type HolidayRow = { date: Date; name: string; isWorkDay: boolean }

const SOURCE_URL = (year: number) => `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`

// 來源資料 → 要寫入 Holiday 表的列：放假日（含週末）isWorkDay=false；週末補班 isWorkDay=true；一般平日不寫
export function planHolidayRows(days: TaiwanCalendarDay[]): HolidayRow[] {
  const rows: HolidayRow[] = []
  for (const item of days) {
    const date = new Date(`${item.date.slice(0, 4)}-${item.date.slice(4, 6)}-${item.date.slice(6, 8)}T00:00:00.000Z`)
    const dow = date.getUTCDay() // 一律 UTC，避免伺服器時區位移
    const isWeekend = dow === 0 || dow === 6
    if (item.isHoliday) {
      rows.push({ date, name: item.description || "國定假日", isWorkDay: false })
    } else if (isWeekend) {
      rows.push({ date, name: item.description || "補班日", isWorkDay: true })
    }
  }
  return rows
}

export type HolidaySyncResult = { year: number; status: "synced" | "not_published"; upserted: number; removed: number }

export async function syncHolidaysForYear(year: number, fetchFn: typeof fetch = fetch): Promise<HolidaySyncResult> {
  const res = await fetchFn(SOURCE_URL(year))
  if (res.status === 404) return { year, status: "not_published", upserted: 0, removed: 0 }
  if (!res.ok) throw new Error(`無法取得 ${year} 年的國定假日資料（HTTP ${res.status}）`)

  const days = (await res.json()) as TaiwanCalendarDay[]
  const rows = planHolidayRows(days)
  for (const r of rows) {
    await prisma.holiday.upsert({
      where: { date: r.date },
      update: { name: r.name, isWorkDay: r.isWorkDay },
      create: { date: r.date, name: r.name, isWorkDay: r.isWorkDay },
    })
  }

  // 來源若取消某天假日（例如更正），DB 也要移除；只有拿到完整一年的資料才刪，避免來源異常時誤刪
  let removed = 0
  if (days.length >= 365) {
    const result = await prisma.holiday.deleteMany({
      where: {
        date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)), notIn: rows.map((r) => r.date) },
      },
    })
    removed = result.count
  }
  return { year, status: "synced", upserted: rows.length, removed }
}
