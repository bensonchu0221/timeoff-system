"use client"

import { useState, useTransition } from "react"
import toast from "react-hot-toast"
import {
  listUserGrantsAction, previewAnnualGrantAction, grantAnnualAction, previewRecalcAction, applyRecalcAction,
} from "@/app/admin/annual-grant-actions"
import type { RecalcChange } from "@/lib/annual-grant"
import { setAnnualLeaveOpening } from "./actions"
import { VoidGrantButton } from "@/app/admin/leave-settings/Forms"

type GrantRow = Awaited<ReturnType<typeof listUserGrantsAction>>[number]
const KIND_LABEL: Record<string, string> = { PRORATA: "首年", ANNUAL: "年度", OPENING: "期初", ADJUSTMENT: "調整" }
const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10)

export function AnnualLeaveCell({ userId, remaining, nextYear, disabled }: {
  userId: string; remaining: number | undefined; nextYear: number; disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<GrantRow[] | null>(null)
  const [nextPreview, setNextPreview] = useState<{ amount: number; text: string } | null>(null)
  const [recalc, setRecalc] = useState<RecalcChange[] | null>(null)
  const [isPending, startTransition] = useTransition()

  const refresh = () => startTransition(async () => {
    try {
      setRows(await listUserGrantsAction(userId))
      const p = await previewAnnualGrantAction(nextYear, [userId])
      setNextPreview(p.toGrant[0] ? { amount: p.toGrant[0].amount, text: p.toGrant[0].basis.text } : null)
    } catch (e) { toast.error((e as Error).message) }
  })

  const issued = rows?.find((r) => !r.voidedAt && r.kind === "ANNUAL" && r.year === nextYear)

  return (
    <div className="text-xs space-y-1 min-w-[180px]">
      <button onClick={() => { setOpen(!open); if (!open) refresh() }} className="font-medium text-gray-900 hover:underline">
        剩 {remaining ?? "-"} 天 {open ? "▲" : "▼"}
      </button>

      {open && rows && (
        <div className="space-y-2 pt-1">
          <ul className="space-y-0.5">
            {rows.map((r) => (
              <li key={r.id} className={r.voidedAt ? "line-through text-gray-400" : "text-gray-700"}
                  title={r.voidedAt ? `作廢：${r.voidReason}` : (r.basis as { text?: string } | null)?.text}>
                {iso(r.effectiveAt)}　{KIND_LABEL[r.kind]}{r.year ? ` ${r.year}` : ""}　{r.amount > 0 ? "+" : ""}{r.amount}
                {!r.voidedAt && (r.kind === "OPENING" || r.kind === "ADJUSTMENT") && <span className="ml-1"><VoidGrantButton id={r.id} /></span>}
              </li>
            ))}
          </ul>

          {issued ? (
            <p className="text-gray-500">已發放 {nextYear}（{issued.source === "SYSTEM_CRON" ? "12/1 排程" : issued.createdBy?.name ?? issued.source}）</p>
          ) : nextPreview ? (
            <button
              disabled={disabled || isPending}
              onClick={() => {
                if (!confirm(`發放 ${nextYear} 年度特休 ${nextPreview.amount} 天？\n${nextPreview.text}`)) return
                startTransition(async () => {
                  try { toast.success((await grantAnnualAction(nextYear, [userId])).message); refresh() }
                  catch (e) { toast.error((e as Error).message) }
                })
              }}
              className="btn btn-xs btn-outline"
            >發放 {nextYear}（{nextPreview.amount} 天）</button>
          ) : null}

          <button
            disabled={disabled || isPending}
            onClick={() => startTransition(async () => {
              try { setRecalc(await previewRecalcAction(userId)) } catch (e) { toast.error((e as Error).message) }
            })}
            className="btn btn-xs btn-ghost"
          >檢查是否需重算</button>

          <OpeningForm userId={userId} disabled={disabled || isPending} onDone={refresh} />
        </div>
      )}

      {recalc && (
        <RecalcBox changes={recalc} onClose={() => setRecalc(null)} onApply={(reason) => startTransition(async () => {
          try { toast.success((await applyRecalcAction(userId, reason)).message); setRecalc(null); refresh() }
          catch (e) { toast.error((e as Error).message) }
        })} />
      )}
    </div>
  )
}

// 期初餘額（舊員工用）：寫入 OPENING 紀錄（setAnnualLeaveOpening 會同步寫發放紀錄）
function OpeningForm({ userId, disabled, onDone }: { userId: string; disabled: boolean; onDone: () => void }) {
  const [show, setShow] = useState(false)
  const [balance, setBalance] = useState("")
  const [at, setAt] = useState("")
  if (!show) return <button onClick={() => setShow(true)} className="btn btn-xs btn-ghost">設定期初餘額</button>
  return (
    <div className="flex flex-wrap items-center gap-1">
      <input type="number" step="0.5" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="天數" className="input input-bordered input-xs w-16" />
      <input type="date" value={at} onChange={(e) => setAt(e.target.value)} className="input input-bordered input-xs" />
      <button
        disabled={disabled || !balance || !at}
        onClick={async () => {
          try {
            const r = await setAnnualLeaveOpening(userId, Number(balance), at, null, null)
            toast.success(r.message); setShow(false); onDone()
          } catch (e) { toast.error((e as Error).message) }
        }}
        className="btn btn-xs btn-primary"
      >儲存</button>
      <button onClick={() => setShow(false)} className="btn btn-xs btn-ghost">取消</button>
    </div>
  )
}

export function RecalcBox({ changes, onApply, onClose }: {
  changes: RecalcChange[]; onApply: (reason: string) => void; onClose: () => void
}) {
  const [reason, setReason] = useState("")
  if (changes.length === 0) {
    return <p className="text-gray-500">發放紀錄與目前到職日一致，不需重算。<button onClick={onClose} className="underline ml-1">關閉</button></p>
  }
  return (
    <div className="border border-amber-300 bg-amber-50 rounded p-2 space-y-1">
      <p className="font-semibold text-amber-900">以下發放與目前到職日不一致，需重算：</p>
      <ul>
        {changes.map((c) => (
          <li key={c.periodKey}>{c.label}　{c.oldAmount ?? "（無）"} → {c.newAmount ?? "（作廢）"} 天{c.newBasis ? `　${c.newBasis.text}` : ""}</li>
        ))}
      </ul>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="重算原因（例：到職日由 X 改為 Y）" className="input input-bordered input-xs w-full" />
      <div className="flex gap-1">
        <button disabled={!reason.trim()} onClick={() => onApply(reason.trim())} className="btn btn-xs btn-warning">確認重算</button>
        <button onClick={onClose} className="btn btn-xs btn-ghost">先不要</button>
      </div>
    </div>
  )
}
