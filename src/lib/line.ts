import crypto from "crypto"

// ----------- 通知偏好類型 -----------
export type LineNotifyKey =
  | "applicationToManager"  // 主管收到員工的請假申請
  | "reviewResult"           // 員工的假單被核准/駁回
  | "departmentLeave"        // 同部門有人請假成功
  | "dailyPending"           // 主管每日 11:00 待審清單
  | "dailyRoster"            // 每日 10:00 全公司請假名單
  | "leaveCancelled"         // 主管 / 同部門：收到撤銷通知
  | "leaveUpdated"           // 主管：員工修改了 PENDING 假單
  | "backupAssigned"         // 被指定為代理人
  | "escalation"             // admin：24h 未審核升級
  | "bossReview"             // 終審者（Boss）：一審通過、待二審終審
  | "firstApproved"          // 申請人：一審已通過、等待終審

/**
 * 判斷是否該發 LINE 給該使用者。
 * - 沒綁 LINE 直接 false
 * - lineNotifyPrefs 為 null 視為全 true（新員工 default 開啟所有通知）
 * - 明確 false 才當作關閉
 */
export function shouldSendLine(
  user: { lineUserId?: string | null; lineNotifyPrefs?: any } | null | undefined,
  key: LineNotifyKey
): boolean {
  if (!user?.lineUserId) return false
  const prefs = user.lineNotifyPrefs as Record<string, boolean> | null | undefined
  if (!prefs) return true
  return prefs[key] !== false
}

// ----------- LINE API 底層 -----------

const LINE_API_BASE = "https://api.line.me/v2/bot"

/**
 * 推播訊息到指定使用者（Push API）
 * - 沒設 LINE_CHANNEL_ACCESS_TOKEN 時 mock log，不真的呼叫
 * - 失敗不 throw，console.error 後 swallow，避免擋住主流程
 */
async function linePush(toUserId: string, messages: any[]): Promise<void> {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN

  if (!accessToken) {
    console.log(`[LINE Mock] Push to ${toUserId}:`, JSON.stringify(messages))
    return
  }

  try {
    const res = await fetch(`${LINE_API_BASE}/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ to: toUserId, messages }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error(`LINE Push Error (${res.status}) to ${toUserId}: ${errText}`)
    }
  } catch (err) {
    console.error("Failed to push LINE message:", err)
  }
}

/**
 * 回覆訊息（Reply API，用 webhook 收到的 replyToken；30 秒內有效，只能用一次）
 */
export async function lineReply(replyToken: string, messages: any[]): Promise<void> {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN

  if (!accessToken) {
    console.log(`[LINE Mock] Reply ${replyToken}:`, JSON.stringify(messages))
    return
  }

  try {
    const res = await fetch(`${LINE_API_BASE}/message/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error(`LINE Reply Error (${res.status}): ${errText}`)
    }
  } catch (err) {
    console.error("Failed to reply LINE message:", err)
  }
}

/**
 * 驗證 webhook 來自 LINE。
 * LINE 用 HMAC-SHA256 簽 channel secret，把 base64 結果放在 x-line-signature header。
 * 必須用「原始 request body 字串」算（不能 parse 後再 stringify，會差一個空格）
 */
export function verifyLineSignature(rawBody: string, signatureHeader: string): boolean {
  const channelSecret = process.env.LINE_CHANNEL_SECRET
  if (!channelSecret) {
    console.warn("LINE_CHANNEL_SECRET 未設定，簽章驗證跳過（僅開發用）")
    return true
  }
  if (!signatureHeader) return false

  const hash = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64")

  // 用 timingSafeEqual 避免 timing attack
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signatureHeader))
  } catch {
    return false
  }
}

// ----------- 對外的通知 helper（鏡像 email.ts 的命名）-----------

/**
 * 通知主管：有員工遞出請假申請。
 * 用 Flex Message 提供「快速核准」按鈕；駁回需理由，導回網頁完成。
 */
export async function sendLineLeaveApplication(
  toLineUserId: string,
  applicantName: string,
  leaveType: string,
  duration: number,
  link: string,
  requestId: string
): Promise<void> {
  const altText = `📩 ${applicantName} 申請了 ${duration} 天 ${leaveType}`
  const flex = buildLeaveApplicationFlex(applicantName, leaveType, duration, link, requestId)
  await linePush(toLineUserId, [{ type: "flex", altText, contents: flex }])
}

/**
 * 兩階段審核：通知終審者（Boss）— 一審已通過、待二審。
 * 沿用申請的 Flex（核准/駁回 postback 走同一條 reviewLeaveAsUser，會依 actor+階段自動判斷為二審）。
 */
export async function sendLineBossReview(
  toLineUserId: string,
  applicantName: string,
  leaveType: string,
  duration: number,
  link: string,
  requestId: string
): Promise<void> {
  const altText = `📩 ${applicantName} 的假單已過一審，待您終審`
  const flex = buildLeaveApplicationFlex(applicantName, leaveType, duration, link, requestId, "📩 終審待審核（一審已通過）")
  await linePush(toLineUserId, [{ type: "flex", altText, contents: flex }])
}

/**
 * 兩階段審核：通知申請人 — 一審已通過、等待終審。
 */
export async function sendLineFirstApproved(
  toLineUserId: string,
  leaveType: string,
): Promise<void> {
  const text = `🕓 一審通過\n假別：${leaveType}\n\n已通過主管審核，送交終審者做最後核准，結果出爐會再通知您。`
  await linePush(toLineUserId, [{ type: "text", text }])
}

// Flex Message bubble：含申請資訊 + 「快速核准」+「駁回」+「前往網頁」三顆 button
function buildLeaveApplicationFlex(
  applicantName: string,
  leaveType: string,
  duration: number,
  link: string,
  requestId: string,
  title: string = "📩 新假單待審核"
) {
  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: title,
          weight: "bold",
          size: "md",
          color: "#ffffff",
        },
      ],
      backgroundColor: "#7A9A8A",
      paddingAll: "12px",
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        infoRow("申請人", applicantName),
        infoRow("假別", leaveType),
        infoRow("天數", `${duration} 天`),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#7A9A8A",
          action: {
            type: "postback",
            label: "快速核准",
            data: `action=approve&requestId=${requestId}`,
            displayText: "我要核准這張假單",
          },
        },
        {
          type: "button",
          style: "secondary",
          color: "#C48F8B",
          action: {
            type: "postback",
            label: "駁回",
            data: `action=reject&requestId=${requestId}`,
            displayText: "我要駁回這張假單",
          },
        },
        {
          type: "button",
          style: "link",
          action: {
            type: "uri",
            label: "前往網頁查看完整資訊",
            uri: link,
          },
        },
      ],
    },
  }
}

// 第二層 Flex：按駁回後問主管要用什麼理由
// 預設清單寫死在這（量少、不常變、放 DB 太重）
export const PRESET_REJECT_REASONS = [
  { label: "直接駁回（不附理由）", reason: "" },           // 空字串 = 沒理由
  { label: "假別額度不足", reason: "假別額度不足" },
  { label: "該期間人力不足", reason: "該期間人力不足，請改期" },
  { label: "請補附證明文件", reason: "請補附證明文件後重新申請" },
  { label: "期程需要調整", reason: "請與主管確認後改期再申請" },
]

export function buildRejectReasonFlex(requestId: string, link: string) {
  return {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: "請選擇駁回方式", weight: "bold", size: "md", color: "#ffffff" },
      ],
      backgroundColor: "#C48F8B",
      paddingAll: "12px",
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "text", text: "員工會收到含此理由的通知", size: "xs", color: "#888888" },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        ...PRESET_REJECT_REASONS.map((r) => ({
          type: "button",
          style: "secondary",
          height: "sm",
          action: {
            type: "postback",
            label: r.label,
            // 把 reason 包進 postback data；空字串代表「不附理由」
            data: `action=reject_with_reason&requestId=${requestId}&reason=${encodeURIComponent(r.reason)}`,
            displayText: r.reason ? `駁回理由：${r.reason}` : "直接駁回（無理由）",
          },
        })),
        {
          type: "button",
          style: "link",
          height: "sm",
          action: {
            type: "uri",
            label: "其他理由 → 開網頁填寫",
            uri: link,
          },
        },
      ],
    },
  }
}

function infoRow(label: string, value: string) {
  return {
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, color: "#999999", size: "sm", flex: 2 },
      { type: "text", text: value, color: "#333333", size: "sm", flex: 5, wrap: true },
    ],
  }
}

/**
 * 通知員工：自己的假單結果出爐。
 */
export async function sendLineLeaveResult(
  toLineUserId: string,
  leaveType: string,
  status: "APPROVED" | "REJECTED",
  message?: string
): Promise<void> {
  const isApproved = status === "APPROVED"
  const head = isApproved ? "✅ 假單已核准" : "❌ 假單已駁回"
  const messageBlock = message?.trim() ? `\n\n主管留言：\n${message.trim()}` : ""
  const text = `${head}\n假別：${leaveType}${messageBlock}`

  await linePush(toLineUserId, [{ type: "text", text }])
}

/**
 * 撤銷通知 — 給原審核主管或同部門。
 * previousStatus 區分 APPROVED 撤銷（影響大）vs PENDING 撤銷（單純取消申請）
 */
export async function sendLineLeaveCancelled(
  toLineUserId: string,
  applicantName: string,
  leaveType: string,
  startDate: Date,
  endDate: Date,
  previousStatus: "PENDING" | "APPROVED"
): Promise<void> {
  const range = formatDateRange(startDate, endDate)
  const head = previousStatus === "APPROVED" ? "⚠️ 已核准假單被撤銷" : "🚫 待審假單已撤銷"
  const tail = previousStatus === "APPROVED"
    ? `\n員工該期間將如常出勤，請依此調整工作安排。`
    : `\n員工已自行撤銷，無需再審核。`
  const text = `${head}\n${applicantName}：${leaveType}（${range}）${tail}`
  await linePush(toLineUserId, [{ type: "text", text }])
}

/**
 * 修改通知 — 給原審核主管。只在 PENDING 修改後觸發。
 */
export async function sendLineLeaveUpdated(
  toLineUserId: string,
  applicantName: string,
  beforeSummary: string,
  afterSummary: string,
  link: string
): Promise<void> {
  const text =
    `✏️ 待審假單已修改\n` +
    `${applicantName} 修改了內容：\n\n` +
    `修改前：${beforeSummary}\n` +
    `修改後：${afterSummary}\n\n` +
    `前往審核：${link}`
  await linePush(toLineUserId, [{ type: "text", text }])
}

/**
 * 代理人通知（被指定為代理人）
 */
export async function sendLineBackupAssigned(
  toLineUserId: string,
  applicantName: string,
  leaveType: string,
  startDate: Date,
  endDate: Date,
  status: "PENDING" | "APPROVED"
): Promise<void> {
  const range = formatDateRange(startDate, endDate)
  const statusLabel = status === "APPROVED" ? "已核准" : "待審核"
  const text =
    `🤝 代理人通知\n` +
    `${applicantName} 將您列為 ${range} 的代理人\n` +
    `假別：${leaveType}\n` +
    `狀態：${statusLabel}\n\n` +
    `若該假單後續未核准或被撤銷，會再通知您。`
  await linePush(toLineUserId, [{ type: "text", text }])
}

/**
 * 代理人解除通知
 */
export async function sendLineBackupRemoved(
  toLineUserId: string,
  applicantName: string,
  leaveType: string,
  startDate: Date,
  endDate: Date,
  reason: "REMOVED_BY_EDIT" | "CANCELLED" | "REJECTED"
): Promise<void> {
  const range = formatDateRange(startDate, endDate)
  const reasonLabel = reason === "CANCELLED" ? "已撤銷" : reason === "REJECTED" ? "已駁回" : "已改指定他人"
  const text =
    `↩️ 代理人解除\n` +
    `${applicantName} 的 ${range} ${leaveType} 假單${reasonLabel}，您不再需要協助代理。`
  await linePush(toLineUserId, [{ type: "text", text }])
}

/**
 * 24 小時未審核升級（給 admin）
 */
export async function sendLineEscalation(
  toLineUserId: string,
  applicantName: string,
  managerName: string,
  leaveType: string,
  startDate: Date,
  endDate: Date,
  hoursPending: number,
  link: string
): Promise<void> {
  const range = formatDateRange(startDate, endDate)
  const text =
    `🚨 假單超時未審核\n` +
    `申請人：${applicantName}\n` +
    `原主管：${managerName || "未指派"}\n` +
    `假別：${leaveType}（${range}）\n` +
    `已 pending ${hoursPending} 小時\n\n` +
    `立即審核：${link}`
  await linePush(toLineUserId, [{ type: "text", text }])
}

/**
 * 通知同部門：有同事的假單核准了。
 */
export async function sendLineSameDepartment(
  toLineUserId: string,
  applicantName: string,
  leaveType: string,
  startDate: Date,
  endDate: Date
): Promise<void> {
  const range = formatDateRange(startDate, endDate)
  const text = `📅 團隊請假提醒\n${applicantName} 將於 ${range} 請${leaveType}`

  await linePush(toLineUserId, [{ type: "text", text }])
}

/**
 * 每日 11:00 推給主管：你還有 N 筆待審核
 */
export async function sendLineDailyPending(
  toLineUserId: string,
  pendingCount: number,
  link: string
): Promise<void> {
  const text =
    `⏰ 每日待審提醒\n` +
    `您目前有 ${pendingCount} 筆假單待審核\n\n` +
    `前往審核：${link}`

  await linePush(toLineUserId, [{ type: "text", text }])
}

/**
 * 每日 10:00 推給全公司在職員工：今天有誰請假
 */
export async function sendLineDailyRoster(
  toLineUserId: string,
  dateLabel: string,
  rosterLines: string[]
): Promise<void> {
  const text = `📋 ${dateLabel} 今日請假\n${rosterLines.join("\n")}`

  await linePush(toLineUserId, [{ type: "text", text }])
}

/**
 * 回 reply：員工查假結果。
 * lines 已經是各假別的字串，例：「特休：可請 8 / 全年 14 天」
 */
export function buildBalanceReply(year: number, lines: string[]): any[] {
  if (lines.length === 0) {
    return [{ type: "text", text: "目前查不到您的假別資料，請聯絡管理員。" }]
  }
  const text = `📊 您的假別查詢（${year}）\n${lines.join("\n")}`
  return [{ type: "text", text }]
}

/**
 * 綁定成功回覆
 */
export function buildBindingSuccessReply(userName: string | null): any[] {
  return [
    {
      type: "text",
      text:
        `✅ 綁定成功！\n` +
        `${userName ? `Hi ${userName}，` : ""}之後您的假勤通知會同時發到 LINE。\n\n` +
        `想關閉特定通知，請到系統「個人設定」調整。\n` +
        `想查假，輸入「查假」即可。`,
    },
  ]
}

/**
 * 加好友（follow）後的引導訊息
 */
export function buildFollowGreeting(): any[] {
  return [
    {
      type: "text",
      text:
        `👋 歡迎使用 Timeoff 假勤系統 Bot！\n\n` +
        `請到系統「個人設定」頁面取得 6 碼綁定碼，貼給我完成綁定後就會收到通知。\n\n` +
        `綁定後可用的指令：\n` +
        `「查假」— 查詢您各假別剩餘天數`,
    },
  ]
}

/**
 * 沒綁定就傳指令的提示
 */
export function buildUnboundReply(): any[] {
  return [
    {
      type: "text",
      text:
        `您還沒綁定喔！\n` +
        `請到系統「個人設定」頁面取得 6 碼綁定碼，再貼給我完成綁定。`,
    },
  ]
}

/**
 * 不認識的訊息 — 簡短說明
 */
export function buildHelpReply(): any[] {
  return [
    {
      type: "text",
      text:
        `目前支援的指令：\n` +
        `「查假」— 查詢您各假別剩餘天數\n\n` +
        `想申請假單請到系統網頁操作。`,
    },
  ]
}

// ----------- 工具：日期格式化 -----------

function formatDateRange(start: Date, end: Date): string {
  const s = formatDate(start)
  const e = formatDate(end)
  return s === e ? s : `${s}–${e}`
}

function formatDate(d: Date): string {
  // 以 Asia/Taipei 顯示，避免 UTC 偏差
  const tw = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }))
  const m = tw.getMonth() + 1
  const day = tw.getDate()
  return `${m}/${day}`
}

// ----------- 查假關鍵字白名單 -----------

const BALANCE_QUERY_KEYWORDS = new Set(["查假", "我的假", "剩多少假", "假"])

export function isBalanceQuery(text: string): boolean {
  return BALANCE_QUERY_KEYWORDS.has(text.trim())
}

// ----------- 綁定碼產生 -----------

/**
 * 產 6 碼綁定碼，避開易混淆字元（0/O/1/I）。
 */
export function generateBindingCode(): string {
  const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
  let code = ""
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}
