import { calcAnnualGrant, periodKey, type GrantBasis, type Override } from "./annual-grant-calc"
import { legacyProRata } from "./legacy-annual-calc"

// 遷移回填：把「舊公式截至 now 已發生的發放」照抄成紀錄，數字與舊公式完全一致。

export type BackfillRow = {
  kind: "PRORATA" | "ANNUAL" | "OPENING" | "ADJUSTMENT"
  year: number | null
  effectiveAt: Date
  amount: number
  basis: GrantBasis
  reason: string | null
  periodKey: string | null
  createdById: string | null
}

export function buildBackfillRows(input: {
  hireDate: Date | null
  opening: { balance: number; at: Date } | null
  overrides: Override[]
  adjustments: { effectiveAt: Date; amount: number; reason: string; createdById: string }[]
  defaultDays: number
  now: Date
}): BackfillRow[] {
  const { hireDate, opening, overrides, adjustments, defaultDays, now } = input
  if (!hireDate) return []
  const rows: BackfillRow[] = []
  const hireYear = hireDate.getUTCFullYear()

  if (opening) {
    rows.push({
      kind: "OPENING", year: null, effectiveAt: opening.at, amount: opening.balance,
      basis: { rule: "MIGRATED_OPENING", text: `期初餘額 ${opening.balance} 天（遷移自舊制）` },
      reason: "遷移自舊制期初餘額", periodKey: null, createdById: null,
    })
  } else {
    const p = legacyProRata(hireDate, defaultDays)
    rows.push({
      kind: "PRORATA", year: hireYear, effectiveAt: hireDate, amount: p.amount,
      basis: {
        rule: "MIGRATED_PRORATA_DAYS", remainingDays: p.remainingDays, yearTotal: p.yearTotal, defaultDays,
        text: `到職首年：${p.remainingDays}/${p.yearTotal} × ${defaultDays} → ${p.amount} 天（遷移自即時公式）`,
      },
      reason: null, periodKey: periodKey("PRORATA", hireYear), createdById: null,
    })
  }

  for (let year = hireYear + 1; year <= now.getUTCFullYear(); year++) {
    const jan1 = new Date(Date.UTC(year, 0, 1))
    if (jan1 > now) break
    if (opening && jan1 <= opening.at) continue // 已含在期初
    const g = calcAnnualGrant(hireDate, year, defaultDays, overrides)
    rows.push({
      kind: "ANNUAL", year, effectiveAt: jan1, amount: g.amount,
      basis: { ...g.basis, rule: "MIGRATED_ANNUAL", text: `${g.basis.text}（遷移自即時公式）` },
      reason: null, periodKey: periodKey("ANNUAL", year), createdById: null,
    })
  }

  for (const a of adjustments) {
    if (opening && a.effectiveAt <= opening.at) continue // 已含在期初
    rows.push({
      kind: "ADJUSTMENT", year: null, effectiveAt: a.effectiveAt, amount: a.amount,
      basis: { rule: "MIGRATED_ADJUSTMENT", text: `HR 調整 ${a.amount > 0 ? "+" : ""}${a.amount} 天（${a.reason}）` },
      reason: a.reason, periodKey: null, createdById: a.createdById,
    })
  }
  return rows
}
