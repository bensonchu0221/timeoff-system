"use client"

import { useState, useTransition } from "react"
import toast from "react-hot-toast"
import { previewAnnualGrantAction, grantAnnualAction } from "@/app/admin/annual-grant-actions"
import type { AnnualPreview } from "@/lib/annual-grant"

const SOURCE_LABEL: Record<string, string> = {
  SYSTEM_CRON: "12/1 排程", HR_BUTTON: "HR 按鈕", HIRE: "新人建檔", RECALC: "重算", MIGRATION: "遷移", CONCURRENT: "同時發放",
}
const fmt = (d: Date | string) => new Date(d).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })

export function AnnualGrantPanel({ years, status }: {
  years: number[]
  status: { year: number; count: number; lastAt: Date | null; lastSource: string | null }[]
}) {
  const [year, setYear] = useState(years[1] ?? years[0])
  const [preview, setPreview] = useState<AnnualPreview | null>(null)
  const [isPending, startTransition] = useTransition()

  const loadPreview = () => startTransition(async () => {
    try { setPreview(await previewAnnualGrantAction(year)) } catch (e) { toast.error((e as Error).message) }
  })
  const confirmGrant = () => startTransition(async () => {
    try {
      const r = await grantAnnualAction(year)
      toast.success(r.message)
      setPreview(null)
    } catch (e) { toast.error((e as Error).message) }
  })

  return (
    <div className="space-y-4">
      <ul className="text-sm text-gray-600 space-y-1">
        {status.map((s) => (
          <li key={s.year}>
            <span className="font-medium text-gray-900">{s.year} 年度發放：</span>
            {s.count === 0 ? "尚未發放" : `已發放 ${s.count} 人（最近 ${fmt(s.lastAt!)}，${SOURCE_LABEL[s.lastSource ?? ""] ?? s.lastSource}）`}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setPreview(null) }} className="select select-bordered select-sm">
          {years.map((y) => <option key={y} value={y}>{y} 年</option>)}
        </select>
        <button onClick={loadPreview} disabled={isPending} className="btn btn-sm btn-outline">預覽全部發放</button>
      </div>

      {preview && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-4 bg-gray-50">
          <Section title={`將發放 ${preview.toGrant.length} 人`}>
            {preview.toGrant.map((g) => <li key={g.userId}><b>{g.name}</b>　{g.amount} 天　<span className="text-gray-500">{g.basis.text}</span></li>)}
          </Section>
          <Section title={`已發放、略過 ${preview.skipped.length} 人`}>
            {preview.skipped.map((s) => <li key={s.userId}>{s.name}　<span className="text-gray-500">{fmt(s.at)}　{SOURCE_LABEL[s.source] ?? s.source}{s.byName ? `（${s.byName}）` : ""}</span></li>)}
          </Section>
          <Section title={`不符資格 ${preview.ineligible.length} 人`}>
            {preview.ineligible.map((i) => <li key={i.userId}>{i.name}　<span className="text-gray-500">{i.reason}</span></li>)}
          </Section>
          <div className="flex gap-2">
            <button onClick={confirmGrant} disabled={isPending || preview.toGrant.length === 0} className="btn btn-sm btn-primary">
              確認發放 {preview.toGrant.length} 人
            </button>
            <button onClick={() => setPreview(null)} disabled={isPending} className="btn btn-sm btn-ghost">取消</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800 mb-1">{title}</h3>
      <ul className="text-sm space-y-0.5 max-h-48 overflow-y-auto">{children}</ul>
    </div>
  )
}
