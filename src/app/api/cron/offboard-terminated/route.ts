import { NextRequest, NextResponse } from "next/server"
import { offboardTerminatedUsers, findTerminatedWithLooseEnds } from "@/lib/offboarding"
import { sendLineAdminNotice } from "@/lib/line"

// 每日 00:10（Asia/Taipei）由 Cloud Scheduler 觸發：最後上班日已過的員工自動收尾
// （解除 LINE 綁定、登出所有裝置）；若仍有在職下屬或待審假單卡在他身上，LINE 提醒 ADMIN 改派。
// 重跑安全：已收尾者不會重複處理。失敗回 500 讓 Scheduler 重試。
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 })
  if (req.headers.get("x-cron-secret") !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  try {
    const offboarded = await offboardTerminatedUsers()
    const loose = await findTerminatedWithLooseEnds()

    const lines: string[] = []
    if (offboarded.length > 0) {
      lines.push(`👋 離職生效：${offboarded.map((u) => u.name || "員工").join("、")}（已解除 LINE 綁定並登出）`)
    }
    if (loose.length > 0) {
      lines.push("⚠️ 以下已離職員工還有事項需要改派：")
      for (const u of loose) {
        const parts = []
        if (u.subordinates > 0) parts.push(`${u.subordinates} 位下屬的直屬主管`)
        if (u.pendingReviews > 0) parts.push(`${u.pendingReviews} 筆待審假單`)
        lines.push(`• ${u.name || "員工"}：${parts.join("、")}`)
      }
      lines.push("請到「使用者管理」改派。")
    }
    if (lines.length > 0) await sendLineAdminNotice(lines.join("\n"))

    return NextResponse.json({ offboarded, loose })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("offboard-terminated failed:", e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
