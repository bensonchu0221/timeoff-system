import { NextRequest, NextResponse } from "next/server"
import { syncHolidaysForYear } from "@/lib/holiday-sync"
import { todayStartUTCFromTaipei } from "@/lib/date-format"
import { sendLineAdminNotice } from "@/lib/line"

// 每年 9/1 06:00（Asia/Taipei）由 Cloud Scheduler 觸發：同步「明年」國定假日，並順便更新「今年」（來源若有更正）。
// 明年資料尚未公布（404）不算失敗。任一年同步失敗回 500 讓 Scheduler 重試。結果只通知 ADMIN。
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  if (req.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const thisYear = todayStartUTCFromTaipei().getUTCFullYear()
  try {
    const results = []
    for (const year of [thisYear + 1, thisYear]) results.push(await syncHolidaysForYear(year))
    const lines = results.map((r) =>
      r.status === "not_published" ? `${r.year} 年：尚未公布` : `${r.year} 年：同步 ${r.upserted} 筆${r.removed ? `、移除 ${r.removed} 筆` : ""}`)
    const summary = `📅 國定假日同步完成\n${lines.join("\n")}`
    console.log(`[sync-holidays] ${lines.join("; ")}`)
    await sendLineAdminNotice(summary)
    return NextResponse.json({ results })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[sync-holidays] failed:", e)
    await sendLineAdminNotice(`❌ 國定假日同步失敗：${msg}\n請到「假別與額度設定 → 國定假日同步」手動同步。`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
