/**
 * 一次性建立 / 更新 LINE Rich Menu（聊天室底部圖文選單），並設為全員預設。
 *
 * 執行：  npx tsx scripts/setup-line-richmenu.ts
 * 需環境變數：LINE_CHANNEL_ACCESS_TOKEN、NEXT_PUBLIC_LIFF_ID
 *
 * 選單為 2 列 × 3 欄：多數格走 LIFF 網頁（點了在 LINE 內開、自動登入），
 * 「快速查假」沿用現有 bot webhook 指令（type: message，回覆各假別餘額）。
 * 選單圖在 scripts/richmenu.png（佔位圖，正式上線可換設計稿，座標不變）。
 */
import { readFile } from "fs/promises"
import { join } from "path"

const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN
const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID

if (!ACCESS_TOKEN) throw new Error("缺少環境變數 LINE_CHANNEL_ACCESS_TOKEN")
if (!LIFF_ID) throw new Error("缺少環境變數 NEXT_PUBLIC_LIFF_ID")

const liffUrl = (path: string) => `https://liff.line.me/${LIFF_ID}${path}`

const richMenu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "timeoff-main",
  chatBarText: "假勤選單",
  areas: [
    // 上排：LIFF 網頁
    { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: "uri", label: "請假申請", uri: liffUrl("/apply") } },
    { bounds: { x: 833, y: 0, width: 834, height: 843 }, action: { type: "uri", label: "我的假單", uri: liffUrl("/") } },
    { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: "uri", label: "團隊甘特圖", uri: liffUrl("/gantt") } },
    // 下排：沿用現有 bot 指令
    { bounds: { x: 0, y: 843, width: 833, height: 843 }, action: { type: "message", label: "快速查假", text: "查假" } },
    { bounds: { x: 833, y: 843, width: 834, height: 843 }, action: { type: "uri", label: "個人設定", uri: liffUrl("/settings") } },
    { bounds: { x: 1667, y: 843, width: 833, height: 843 }, action: { type: "uri", label: "審核假單", uri: liffUrl("/admin/approvals") } },
  ],
}

const API = "https://api.line.me/v2/bot"
const DATA_API = "https://api-data.line.me/v2/bot"
const authHeader = { Authorization: `Bearer ${ACCESS_TOKEN}` }

async function main() {
  // 1. 建立 rich menu 結構
  const createRes = await fetch(`${API}/richmenu`, {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: JSON.stringify(richMenu),
  })
  if (!createRes.ok) throw new Error(`建立 richmenu 失敗 (${createRes.status}): ${await createRes.text()}`)
  const { richMenuId } = await createRes.json()
  console.log("已建立 richMenuId:", richMenuId)

  // 2. 上傳選單圖
  const img = await readFile(join(process.cwd(), "scripts", "richmenu.png"))
  const uploadRes = await fetch(`${DATA_API}/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "image/png" },
    body: img,
  })
  if (!uploadRes.ok) throw new Error(`上傳選單圖失敗 (${uploadRes.status}): ${await uploadRes.text()}`)
  console.log("選單圖已上傳")

  // 3. 設為全員預設選單
  const defRes = await fetch(`${API}/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: authHeader,
  })
  if (!defRes.ok) throw new Error(`設定預設選單失敗 (${defRes.status}): ${await defRes.text()}`)
  console.log("已設為全員預設選單 ✅")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
