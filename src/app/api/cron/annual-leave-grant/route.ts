import { NextRequest, NextResponse } from "next/server"
import { grantAnnualForYear } from "@/lib/annual-grant"
import { openYearFor } from "@/lib/annual-grant-calc"
import { todayStartUTCFromTaipei } from "@/lib/date-format"
import { sendLineAdminNotice } from "@/lib/line"

// 每年 12/1 06:00（Asia/Taipei）由 Cloud Scheduler 觸發：發「明年」的年度特休（生效日 = 明年 1/1）。
// 重跑安全：已發放者由 DB 唯一鍵略過。失敗回 500 讓 Scheduler 重試。結果只通知 ADMIN。
// 12/1 前被呼叫時 openYearFor 回傳今年（已由遷移寫入）→ 全部略過，不會誤發。
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  if (req.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const year = openYearFor(todayStartUTCFromTaipei())
  try {
    const r = await grantAnnualForYear(year, { source: "SYSTEM_CRON", actorId: null })
    const summary = `✅ ${year} 年度特休發放完成：發放 ${r.granted.length} 人、略過 ${r.skipped.length} 人、不符資格 ${r.ineligible.length} 人`
    console.log(`[annual-leave-grant] ${summary}`)
    await sendLineAdminNotice(summary)
    return NextResponse.json({ year, granted: r.granted.length, skipped: r.skipped.length, ineligible: r.ineligible.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[annual-leave-grant] ${year} failed:`, e)
    await sendLineAdminNotice(`❌ ${year} 年度特休發放失敗：${msg}\n請到「假別與額度設定」用「全部發放」補發。`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
