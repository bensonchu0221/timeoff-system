// 產生符合 RFC 5545 的 iCalendar (.ics) 字串。
// 用 all-day VEVENT（DTSTART;VALUE=DATE）；DTEND 在 all-day 為「exclusive」，
// 因此 6/1~6/3 的假單要產 DTSTART=20260601 / DTEND=20260604。

export type ICalEvent = {
  uid: string
  startDate: Date  // 含當天
  endDate: Date    // 含當天
  summary: string
  description?: string
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

// 將 Date 物件轉為 YYYYMMDD（以 UTC 視角，因 DB 中 startDate 為 UTC midnight）
function toDateOnly(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
}

function toDateTimeStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

// 文字內換行 / 逗號 / 分號 都要 escape，並把實際字串換行折成 \\n
function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
}

// RFC 5545 規定每行最多 75 octet，超過要折行；折行後續行以單一空白起首
function foldLine(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  let i = 0
  while (i < line.length) {
    parts.push((i === 0 ? "" : " ") + line.slice(i, i + (i === 0 ? 75 : 74)))
    i += i === 0 ? 75 : 74
  }
  return parts.join("\r\n")
}

export function buildICS(calendarName: string, events: ICalEvent[]): string {
  const lines: string[] = []
  lines.push("BEGIN:VCALENDAR")
  lines.push("VERSION:2.0")
  lines.push("PRODID:-//Timeoff//ZH-TW//EN")
  lines.push("CALSCALE:GREGORIAN")
  lines.push("METHOD:PUBLISH")
  lines.push(foldLine(`NAME:${escapeText(calendarName)}`))
  lines.push(foldLine(`X-WR-CALNAME:${escapeText(calendarName)}`))
  lines.push("X-WR-TIMEZONE:Asia/Taipei")

  const now = new Date()
  const stamp = toDateTimeStamp(now)

  for (const ev of events) {
    // DTEND 為 exclusive：要把 endDate 再 +1 天
    const dtend = new Date(ev.endDate)
    dtend.setUTCDate(dtend.getUTCDate() + 1)

    lines.push("BEGIN:VEVENT")
    lines.push(foldLine(`UID:${ev.uid}`))
    lines.push(`DTSTAMP:${stamp}`)
    lines.push(`DTSTART;VALUE=DATE:${toDateOnly(ev.startDate)}`)
    lines.push(`DTEND;VALUE=DATE:${toDateOnly(dtend)}`)
    lines.push(foldLine(`SUMMARY:${escapeText(ev.summary)}`))
    if (ev.description) {
      lines.push(foldLine(`DESCRIPTION:${escapeText(ev.description)}`))
    }
    lines.push("TRANSP:TRANSPARENT")  // 不阻擋會議排程衝突偵測，依使用者偏好可改 OPAQUE
    lines.push("END:VEVENT")
  }

  lines.push("END:VCALENDAR")
  return lines.join("\r\n")
}
