"use client"

import { useState, useTransition } from "react"
import { CalendarDays, Copy, Check, RefreshCw } from "lucide-react"
import { getMyCalendarUrl, getTeamCalendarUrl, getCompanyCalendarUrl, resetCalendarToken } from "@/app/actions/calendar"
import toast from "react-hot-toast"

// 一個按鈕展開 popover，顯示訂閱網址、複製、重設 token
export function CalendarSubscribeButton() {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [myUrl, setMyUrl] = useState<string | null>(null)
  const [teamUrl, setTeamUrl] = useState<string | null>(null)
  const [companyUrl, setCompanyUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState<"my" | "team" | "company" | null>(null)

  const loadUrls = () => {
    startTransition(async () => {
      try {
        const [my, team, company] = await Promise.all([
          getMyCalendarUrl(),
          getTeamCalendarUrl(),
          getCompanyCalendarUrl(),
        ])
        setMyUrl(my.url)
        setTeamUrl(team.url)
        setCompanyUrl(company.url)
      } catch (err: any) {
        toast.error(err.message || "取得訂閱網址失敗")
      }
    })
  }

  const handleOpen = () => {
    setOpen(true)
    if (!myUrl) loadUrls()
  }

  const copy = (url: string, which: "my" | "team" | "company") => {
    navigator.clipboard.writeText(url)
    setCopied(which)
    toast.success("已複製到剪貼簿")
    setTimeout(() => setCopied(null), 1500)
  }

  const reset = () => {
    if (!confirm("重設後舊的訂閱網址會立即失效，需要重新貼到行事曆。確定要繼續？")) return
    startTransition(async () => {
      try {
        await resetCalendarToken()
        setMyUrl(null)
        setTeamUrl(null)
        setCompanyUrl(null)
        toast.success("已重設訂閱 token")
        loadUrls()
      } catch (err: any) {
        toast.error(err.message || "重設失敗")
      }
    })
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={handleOpen}
        className="btn btn-circle btn-ghost btn-sm"
        title="訂閱請假行事曆"
      >
        <CalendarDays className="w-5 h-5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl border border-gray-100 p-5 max-w-lg w-full flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-lg font-medium text-gray-900">訂閱請假行事曆</h3>
              <p className="text-xs text-gray-500 mt-1">
                把網址貼到 Google Calendar → 「其他日曆」→ 「來自網址」即可訂閱。請假事件會自動同步（每隔 5–15 分鐘更新）。
              </p>
            </div>

            <UrlBlock label="個人版（只有我自己的請假）" url={myUrl} loading={isPending && !myUrl} onCopy={() => myUrl && copy(myUrl, "my")} copied={copied === "my"} />
            <UrlBlock label="團隊版（我的主管 + 同組成員）" url={teamUrl} loading={isPending && !teamUrl} onCopy={() => teamUrl && copy(teamUrl, "team")} copied={copied === "team"} />
            <UrlBlock label="全公司版（所有人的請假）" url={companyUrl} loading={isPending && !companyUrl} onCopy={() => companyUrl && copy(companyUrl, "company")} copied={copied === "company"} />

            <div className="flex justify-between items-center mt-2 pt-3 border-t border-gray-100">
              <button
                onClick={reset}
                disabled={isPending}
                className="text-xs text-gray-500 hover:text-gray-700 inline-flex items-center gap-1 disabled:opacity-50"
                title="若網址外洩，重設後舊網址即刻失效"
              >
                <RefreshCw className="w-3 h-3" />
                重設訂閱網址
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-sm px-3 py-1 text-gray-600 hover:bg-gray-100 rounded"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UrlBlock({ label, url, loading, onCopy, copied }: { label: string; url: string | null; loading: boolean; onCopy: () => void; copied: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-700 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={loading ? "載入中..." : (url || "")}
          className="input input-bordered input-sm flex-1 bg-gray-50 text-xs font-mono"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <button
          onClick={onCopy}
          disabled={!url}
          className="btn btn-sm btn-ghost border border-gray-300 disabled:opacity-50"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  )
}
