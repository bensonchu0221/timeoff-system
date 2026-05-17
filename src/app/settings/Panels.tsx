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

  return (
    <section className="bg-white rounded-lg shadow border border-gray-200 p-6">
      <h2 className="text-lg font-medium mb-4">綁定 LINE 帳號</h2>

      <ol className="text-sm text-gray-700 space-y-2 mb-6 list-decimal list-inside">
        <li>用手機掃右側 QR Code 加 Bot 好友</li>
        <li>按下「產生綁定碼」拿到 6 碼</li>
        <li>把綁定碼貼給 Bot，看到「綁定成功」就完成</li>
      </ol>

      <div className="flex flex-col sm:flex-row gap-6 items-start">
        {/* QR Code */}
        <div className="flex-shrink-0">
          {qrSrc ? (
            <img
              src={qrSrc}
              alt="LINE Bot QR Code"
              className="w-48 h-48 rounded-md border border-gray-200"
            />
          ) : (
            <div className="w-48 h-48 rounded-md border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400 p-3 text-center">
              系統管理員尚未設定 LINE_BOT_BASIC_ID
            </div>
          )}
          {lineFriendUrl && (
            <a
              href={lineFriendUrl}
              target="_blank"
              rel="noreferrer"
              className="block mt-2 text-xs text-center text-blue-600 hover:underline"
            >
              或點此用 LINE 開啟
            </a>
          )}
        </div>

        {/* 綁定碼 */}
        <div className="flex-1 w-full">
          {currentCode ? (
            <div className="space-y-3">
              <div className="p-4 rounded-md bg-gray-50 border border-gray-200">
                <div className="text-xs text-gray-500 mb-1">您的綁定碼</div>
                <div className="text-3xl font-mono font-bold tracking-widest text-gray-900">
                  {currentCode}
                </div>
                {currentExpiry && (
                  <div className="text-xs text-gray-500 mt-2">
                    有效期限：
                    {new Date(currentExpiry).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500">
                請複製這 6 碼，貼到剛剛加好友的 Bot 對話視窗。
              </p>
              <button
                onClick={handleGenerate}
                disabled={isPending}
                className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
              >
                {isPending ? "產生中..." : "重新產生"}
              </button>
            </div>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={isPending}
              className="w-full sm:w-auto bg-[var(--brand-primary)] text-white px-4 py-2 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition disabled:bg-gray-400"
            >
              {isPending ? "產生中..." : "產生綁定碼"}
            </button>
          )}
        </div>
      </div>
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
