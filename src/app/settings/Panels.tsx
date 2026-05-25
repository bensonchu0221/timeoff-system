"use client"

import { useState, useTransition } from "react"
import toast from "react-hot-toast"
import {
  generateLineBindingCode,
  unbindLine,
  updateLineNotifyPref,
} from "./actions"

// ----------- LINE 綁定區塊 -----------

export function LineBindingPanel({
  isBound,
  boundAt,
  bindingCode,
  bindingExpiry,
  botBasicId,
}: {
  isBound: boolean
  boundAt: Date | null
  bindingCode: string | null
  bindingExpiry: Date | null
  botBasicId: string
}) {
  const [isPending, startTransition] = useTransition()
  const [currentCode, setCurrentCode] = useState(bindingCode)
  const [currentExpiry, setCurrentExpiry] = useState(bindingExpiry)

  const handleGenerate = () => {
    startTransition(async () => {
      try {
        const res = await generateLineBindingCode()
        setCurrentCode(res.code)
        setCurrentExpiry(new Date(Date.now() + 30 * 60 * 1000))
        toast.success("已產生新的綁定碼")
      } catch (err: any) {
        toast.error(err.message || "產生失敗")
      }
    })
  }

  const handleUnbind = () => {
    if (!confirm("確定要解除綁定 LINE 嗎？解除後將不會再收到 LINE 通知。")) return
    startTransition(async () => {
      try {
        await unbindLine()
        toast.success("已解除綁定")
      } catch (err: any) {
        toast.error(err.message || "解除綁定失敗")
      }
    })
  }

  if (isBound) {
    return (
      <section className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-medium mb-4">LINE 綁定狀態</h2>
        <div className="flex items-center justify-between gap-4 p-4 rounded-md bg-green-50 border border-green-200">
          <div>
            <div className="font-medium text-green-800">✅ 已綁定</div>
            {boundAt && (
              <div className="text-xs text-gray-500 mt-1">
                綁定時間：{new Date(boundAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
              </div>
            )}
          </div>
          <button
            onClick={handleUnbind}
            disabled={isPending}
            className="text-sm px-3 py-1.5 rounded-md border border-red-300 text-red-600 hover:bg-red-50 transition disabled:opacity-50"
          >
            {isPending ? "處理中..." : "解除綁定"}
          </button>
        </div>
      </section>
    )
  }

  // 未綁定
  const lineFriendUrl = botBasicId
    ? `https://line.me/R/ti/p/${encodeURIComponent(botBasicId)}`
    : null
  const qrSrc = lineFriendUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(lineFriendUrl)}`
    : null
  // deep link：直接打開 Bot 對話、訊息欄帶入綁定碼。已加好友者點一下就可送出。
  const oaMessageUrl = botBasicId && currentCode
    ? `https://line.me/R/oaMessage/${encodeURIComponent(botBasicId)}/?${encodeURIComponent(currentCode)}`
    : null

  const handleCopyCode = async () => {
    if (!currentCode) return
    try {
      await navigator.clipboard.writeText(currentCode)
      toast.success("綁定碼已複製")
    } catch {
      toast.error("複製失敗，請手動選取")
    }
  }

  return (
    <section className="bg-white rounded-lg shadow border border-gray-200 p-6">
      <h2 className="text-lg font-medium mb-2">綁定 LINE 帳號</h2>
      <p className="text-sm text-gray-500 mb-6">
        依下方四個步驟完成綁定，之後即可在 LINE 收到請假相關即時通知。
      </p>

      <ul className="steps steps-vertical w-full">
        {/* 步驟 1：加入請假小幫手好友 */}
        <li className="step step-primary">
          <div className="text-start pl-2 py-3 w-full">
            <div className="font-bold text-gray-900">加入「請假小幫手」LINE 好友</div>
            <div className="text-sm text-gray-600 mt-1 mb-3">
              用手機掃下方 QR Code，或在手機上點按鈕直接開啟加好友頁。已是好友請略過此步。
            </div>
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt="請假小幫手 QR Code"
                  className="w-40 h-40 rounded-md border border-gray-200 shrink-0"
                />
              ) : (
                <div className="w-40 h-40 rounded-md border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400 p-3 text-center shrink-0">
                  系統管理員尚未設定 LINE_BOT_BASIC_ID
                </div>
              )}
              {lineFriendUrl && (
                <a
                  href={lineFriendUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm px-3 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition inline-block"
                >
                  用 LINE 直接開啟加好友頁
                </a>
              )}
            </div>
          </div>
        </li>

        {/* 步驟 2：產生綁定碼 */}
        <li className="step step-primary">
          <div className="text-start pl-2 py-3 w-full">
            <div className="font-bold text-gray-900">產生綁定碼</div>
            <div className="text-sm text-gray-600 mt-1 mb-3">
              按下按鈕產生一組 6 碼綁定碼（30 分鐘內有效）。
            </div>
            {currentCode ? (
              <div className="p-4 rounded-md bg-gray-50 border border-gray-200 inline-block">
                <div className="text-xs text-gray-500 mb-2">您的綁定碼</div>
                <div className="flex items-center gap-3">
                  <div className="text-3xl font-mono font-bold tracking-widest text-gray-900">
                    {currentCode}
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition shrink-0"
                  >
                    複製
                  </button>
                </div>
                {currentExpiry && (
                  <div className="text-xs text-gray-500 mt-3">
                    有效期限：{new Date(currentExpiry).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
                  </div>
                )}
                <button
                  onClick={handleGenerate}
                  disabled={isPending}
                  className="block text-xs text-gray-500 hover:text-gray-700 underline mt-2 disabled:opacity-50"
                >
                  {isPending ? "產生中..." : "重新產生"}
                </button>
              </div>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={isPending}
                className="bg-[var(--brand-primary)] text-white px-5 py-2.5 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition disabled:bg-gray-400"
              >
                {isPending ? "產生中..." : "產生綁定碼"}
              </button>
            )}
          </div>
        </li>

        {/* 步驟 3：把綁定碼送進請假小幫手 */}
        <li className="step step-primary">
          <div className="text-start pl-2 py-3 w-full">
            <div className="font-bold text-gray-900">把綁定碼送進「請假小幫手」</div>
            <div className="text-sm text-gray-600 mt-1 mb-3">
              點下方按鈕會跳到請假小幫手對話框、訊息欄已自動帶入綁定碼，按 LINE 的送出鍵即可。
            </div>
            {oaMessageUrl ? (
              <a
                href={oaMessageUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block bg-[var(--brand-primary)] text-white px-5 py-2.5 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition"
              >
                在 LINE 開啟對話框並送出綁定碼
              </a>
            ) : (
              <div className="text-sm text-gray-400 italic">
                請先完成步驟 2 產生綁定碼
              </div>
            )}

            <div className="mt-4 max-w-xs">
              <LineChatIllustration codeToShow={currentCode || "ABC123"} />
              <div className="text-xs text-gray-400 text-center mt-1">操作示意圖</div>
            </div>
          </div>
        </li>

        {/* 步驟 4：完成 */}
        <li className="step step-primary">
          <div className="text-start pl-2 py-3 w-full">
            <div className="font-bold text-gray-900">完成綁定</div>
            <div className="text-sm text-gray-600 mt-1">
              送出綁定碼後請假小幫手會自動回覆綁定成功，本頁也會自動刷新顯示「✅ 已綁定」狀態與下方通知偏好設定。
            </div>
          </div>
        </li>
      </ul>
    </section>
  )
}

// 步驟 3 的 LINE 對話示意圖：聊天視窗 + 自動帶入的綁定碼 + 送出鈕標註
function LineChatIllustration({ codeToShow }: { codeToShow: string }) {
  return (
    <svg
      viewBox="0 0 320 240"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-auto"
      role="img"
      aria-label="LINE 對話框示意圖：訊息欄已自動帶入綁定碼，按右側送出鍵即可完成綁定"
    >
      <defs>
        <marker id="chatArrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#a36863" />
        </marker>
      </defs>

      {/* 聊天視窗外框 */}
      <rect x="10" y="10" width="300" height="220" rx="12" fill="#f6f7f8" stroke="#d1d5db" strokeWidth="1.5" />

      {/* 上方標題列（LINE 綠） */}
      <path d="M 10 22 Q 10 10 22 10 L 298 10 Q 310 10 310 22 L 310 42 L 10 42 Z" fill="#06C755" />
      <text x="160" y="30" textAnchor="middle" fill="white" fontSize="13" fontWeight="600">請假小幫手</text>

      {/* Bot 訊息泡泡 */}
      <rect x="22" y="58" width="200" height="42" rx="10" fill="white" stroke="#e5e7eb" />
      <text x="32" y="78" fill="#374151" fontSize="11">您好！請輸入綁定碼</text>
      <text x="32" y="93" fill="#374151" fontSize="11">完成綁定 👋</text>

      {/* 標註 1：綁定碼會自動帶入 */}
      <text x="20" y="135" fill="#a36863" fontSize="11" fontWeight="600">綁定碼會自動帶入</text>
      <line x1="95" y1="142" x2="95" y2="172" stroke="#a36863" strokeWidth="1.5" markerEnd="url(#chatArrow)" />

      {/* 標註 2：按這顆送出 */}
      <text x="245" y="135" fill="#a36863" fontSize="11" fontWeight="600">按這顆送出</text>
      <line x1="288" y1="142" x2="288" y2="172" stroke="#a36863" strokeWidth="1.5" markerEnd="url(#chatArrow)" />

      {/* 輸入欄 */}
      <rect x="18" y="180" width="240" height="38" rx="19" fill="white" stroke="#7A9A8A" strokeWidth="2" />
      <text x="80" y="206" fill="#111827" fontSize="18" fontFamily="monospace" fontWeight="bold" letterSpacing="2">{codeToShow}</text>

      {/* 送出按鈕（黃色描邊強調） */}
      <circle cx="288" cy="199" r="18" fill="#06C755" stroke="#facc15" strokeWidth="3" />
      <path d="M 282 192 L 295 199 L 282 206 Z" fill="white" />
    </svg>
  )
}

// ----------- 通知偏好區塊 -----------

type PrefDef = {
  key: string
  label: string
  description: string
  managerOnly: boolean
}

const PREF_DEFS: PrefDef[] = [
  {
    key: "applicationToManager",
    label: "收到員工假單",
    description: "部屬遞假單給我審核時推播",
    managerOnly: true,
  },
  {
    key: "leaveUpdated",
    label: "員工修改待審假單",
    description: "部屬在我審核前修改假單內容時推播",
    managerOnly: true,
  },
  {
    key: "leaveCancelled",
    label: "假單撤銷通知",
    description: "員工撤銷假單時推播（主管收到部屬撤銷、同部門收到同事撤銷）",
    managerOnly: false,
  },
  {
    key: "reviewResult",
    label: "我的假單結果",
    description: "我的假單被核准或駁回時推播",
    managerOnly: false,
  },
  {
    key: "firstApproved",
    label: "我的假單一審通過",
    description: "我的假單通過主管一審、送交 Boss 終審時推播",
    managerOnly: false,
  },
  {
    key: "bossReview",
    label: "待我終審（Boss）",
    description: "有假單通過一審、等我做最後核准時推播",
    managerOnly: true,
  },
  {
    key: "departmentLeave",
    label: "同部門請假提醒",
    description: "同部門有人請假核准時推播",
    managerOnly: false,
  },
  {
    key: "backupAssigned",
    label: "我被指定為代理人",
    description: "同事請假時把我列為代理人會推播",
    managerOnly: false,
  },
  {
    key: "dailyPending",
    label: "每日 11:00 待審清單",
    description: "每日 11:00 推播當下有幾筆待我審的假單",
    managerOnly: true,
  },
  {
    key: "dailyRoster",
    label: "每日 10:00 全公司請假名單",
    description: "每日 10:00 推播全公司今天有誰請假",
    managerOnly: false,
  },
  {
    key: "escalation",
    label: "假單未審核升級提醒",
    description: "有假單超過 24 小時未審核時推播給 admin",
    managerOnly: true, // admin / manager 才看得到
  },
]

export function NotifyPrefsPanel({
  prefs,
  isManager,
}: {
  prefs: Record<string, boolean>
  isManager: boolean
}) {
  const visible = PREF_DEFS.filter((p) => !p.managerOnly || isManager)

  return (
    <section className="bg-white rounded-lg shadow border border-gray-200 p-6">
      <h2 className="text-lg font-medium mb-2">LINE 通知偏好</h2>
      <p className="text-sm text-gray-500 mb-4">
        關閉後不影響 Email 通知，您仍會收到信件。
      </p>
      <div className="divide-y divide-gray-100">
        {visible.map((def) => (
          <PrefToggle
            key={def.key}
            def={def}
            initialEnabled={prefs[def.key] !== false}
          />
        ))}
      </div>
    </section>
  )
}

function PrefToggle({
  def,
  initialEnabled,
}: {
  def: PrefDef
  initialEnabled: boolean
}) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [isPending, startTransition] = useTransition()

  const handleToggle = () => {
    const next = !enabled
    setEnabled(next) // 樂觀更新
    startTransition(async () => {
      try {
        await updateLineNotifyPref(def.key as any, next)
      } catch (err: any) {
        setEnabled(!next) // 失敗回滾
        toast.error(err.message || "更新失敗")
      }
    })
  }

  return (
    <div className="flex items-center justify-between py-3 gap-4">
      <div className="flex-1">
        <div className="font-medium text-gray-900">{def.label}</div>
        <div className="text-xs text-gray-500 mt-0.5">{def.description}</div>
      </div>
      <input
        type="checkbox"
        className="toggle toggle-success"
        checked={enabled}
        onChange={handleToggle}
        disabled={isPending}
      />
    </div>
  )
}
