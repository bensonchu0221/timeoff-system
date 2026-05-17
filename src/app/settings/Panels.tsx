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
    if (!confirm("確定要解綁 LINE 嗎？解綁後將不會再收到 LINE 通知。")) return
    startTransition(async () => {
      try {
        await unbindLine()
        toast.success("已解綁")
      } catch (err: any) {
        toast.error(err.message || "解綁失敗")
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
            {isPending ? "處理中..." : "解綁"}
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
      <h2 className="text-lg font-medium mb-4">綁定 LINE 帳號</h2>

      {/* Step 1: 綁定碼是主角 */}
      {currentCode ? (
        <div className="space-y-4">
          <div className="p-5 rounded-md bg-gray-50 border border-gray-200">
            <div className="text-xs text-gray-500 mb-2">您的綁定碼（30 分鐘內有效）</div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-4xl font-mono font-bold tracking-widest text-gray-900">
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
          </div>

          {/* Step 2a: 已加好友走這條 — deep link 自動帶入訊息 */}
          {oaMessageUrl && (
            <a
              href={oaMessageUrl}
              target="_blank"
              rel="noreferrer"
              className="block w-full text-center bg-[var(--brand-primary)] text-white px-4 py-3 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition"
            >
              在 LINE 開啟對話框並送出綁定碼
            </a>
          )}

          <p className="text-xs text-gray-500 text-center">
            點上方按鈕會跳到 Bot 對話框、訊息欄已自動填入綁定碼，按「送出」即可完成綁定。
          </p>

          <button
            onClick={handleGenerate}
            disabled={isPending}
            className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
          >
            {isPending ? "產生中..." : "重新產生綁定碼"}
          </button>

          {/* Step 2b: 還沒加好友走這條 — 收合區塊 */}
          <details className="mt-4 border-t border-gray-100 pt-4">
            <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-900">
              還沒加 Bot 好友？點此展開 QR Code
            </summary>
            <div className="mt-4 flex flex-col sm:flex-row gap-4 items-start">
              {qrSrc ? (
                <img
                  src={qrSrc}
                  alt="LINE Bot QR Code"
                  className="w-40 h-40 rounded-md border border-gray-200 shrink-0"
                />
              ) : (
                <div className="w-40 h-40 rounded-md border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400 p-3 text-center shrink-0">
                  系統管理員尚未設定 LINE_BOT_BASIC_ID
                </div>
              )}
              <div className="text-sm text-gray-600 space-y-2">
                <p>用手機掃左側 QR Code 把 Bot 加為好友，加好友後回來按上面的「在 LINE 開啟對話框」按鈕完成綁定。</p>
                {lineFriendUrl && (
                  <a
                    href={lineFriendUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block text-blue-600 hover:underline text-xs"
                  >
                    或點此用 LINE 直接開啟加好友頁
                  </a>
                )}
              </div>
            </div>
          </details>
        </div>
      ) : (
        // 還沒產綁定碼：首頁只強調這顆按鈕
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            按下下方按鈕產生 6 碼綁定碼，把它送給 LINE Bot 就完成綁定。
          </p>
          <button
            onClick={handleGenerate}
            disabled={isPending}
            className="w-full sm:w-auto bg-[var(--brand-primary)] text-white px-6 py-3 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition disabled:bg-gray-400"
          >
            {isPending ? "產生中..." : "產生綁定碼"}
          </button>
        </div>
      )}
    </section>
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
    label: "每日 10:00 同部門請假名單",
    description: "每日 10:00 推播同部門今天有誰請假",
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
