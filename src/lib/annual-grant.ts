import { Prisma } from "@prisma/client"
import { prisma } from "./db"
import { todayStartUTCFromTaipei } from "./date-format"
import {
  calcAnnualGrant, calcProRataGrant, annualIneligibleReason, openYearFor, periodKey, isoDate,
  type GrantBasis, type Override,
} from "./annual-grant-calc"

// 特休發放紀錄的唯一寫入入口：排程、HR 按鈕、新人、離職、重算、調整、期初都經過這裡。

type GrantSource = "SYSTEM_CRON" | "HR_BUTTON" | "HIRE" | "RECALC"

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"

const displayName = (u: { name: string | null }) => u.name ?? "(未命名)"

export async function getAnnualLeaveType() {
  const lt = await prisma.leaveType.findFirst({
    where: { isActive: true, name: { contains: "特休" } },
    select: { id: true, name: true, defaultDays: true },
  })
  if (!lt) throw new Error("找不到特休假別")
  return lt
}

async function loadOverrides(leaveTypeId: string, userIds: string[]): Promise<Map<string, Override[]>> {
  const rows = await prisma.userLeaveBalance.findMany({
    where: { leaveTypeId, userId: { in: userIds } },
    orderBy: { year: "asc" },
    select: { userId: true, year: true, totalQuota: true },
  })
  const map = new Map<string, Override[]>()
  for (const r of rows) {
    const list = map.get(r.userId) ?? []
    list.push({ year: r.year, totalQuota: r.totalQuota })
    map.set(r.userId, list)
  }
  return map
}

export type AnnualPreview = {
  year: number
  toGrant: { userId: string; name: string; amount: number; basis: GrantBasis }[]
  skipped: { userId: string; name: string; at: Date; source: string; byName: string | null }[]
  ineligible: { userId: string; name: string; reason: string }[]
}

export async function previewAnnualForYear(year: number, opts: { userIds?: string[] } = {}): Promise<AnnualPreview> {
  const lt = await getAnnualLeaveType()
  const users = await prisma.user.findMany({
    where: opts.userIds ? { id: { in: opts.userIds } } : {},
    select: { id: true, name: true, hireDate: true, terminatedDate: true },
    orderBy: { name: "asc" },
  })
  const ids = users.map((u) => u.id)
  const existing = await prisma.annualLeaveGrant.findMany({
    where: { userId: { in: ids }, periodKey: periodKey("ANNUAL", year), voidedAt: null },
    select: { userId: true, createdAt: true, source: true, createdBy: { select: { name: true } } },
  })
  const openings = await prisma.annualLeaveGrant.findMany({
    where: { userId: { in: ids }, kind: "OPENING", voidedAt: null },
    select: { userId: true, effectiveAt: true },
  })
  const existingBy = new Map(existing.map((e) => [e.userId, e]))
  const openingBy = new Map(openings.map((o) => [o.userId, o.effectiveAt]))
  const overrides = await loadOverrides(lt.id, ids)
  const jan1 = new Date(Date.UTC(year, 0, 1))

  const result: AnnualPreview = { year, toGrant: [], skipped: [], ineligible: [] }
  for (const u of users) {
    const name = displayName(u)
    const ex = existingBy.get(u.id)
    if (ex) {
      result.skipped.push({ userId: u.id, name, at: ex.createdAt, source: ex.source, byName: ex.createdBy?.name ?? null })
      continue
    }
    const reason = annualIneligibleReason(u, year)
    if (reason) { result.ineligible.push({ userId: u.id, name, reason }); continue }
    const openingAt = openingBy.get(u.id)
    if (openingAt && openingAt >= jan1) {
      result.ineligible.push({ userId: u.id, name, reason: "期初餘額已包含此年度" })
      continue
    }
    const g = calcAnnualGrant(u.hireDate!, year, lt.defaultDays, overrides.get(u.id) ?? [])
    result.toGrant.push({ userId: u.id, name, amount: g.amount, basis: g.basis })
  }
  return result
}

export async function grantAnnualForYear(
  year: number,
  opts: { userIds?: string[]; source: GrantSource; actorId?: string | null },
) {
  const preview = await previewAnnualForYear(year, { userIds: opts.userIds })
  const granted: AnnualPreview["toGrant"] = []
  const skipped = [...preview.skipped]
  for (const g of preview.toGrant) {
    try {
      await prisma.annualLeaveGrant.create({
        data: {
          userId: g.userId, kind: "ANNUAL", year, effectiveAt: new Date(Date.UTC(year, 0, 1)),
          amount: g.amount, basis: g.basis, reason: null, source: opts.source,
          createdById: opts.actorId ?? null, periodKey: periodKey("ANNUAL", year),
        },
      })
      granted.push(g)
    } catch (e) {
      // 另一邊（排程或 HR 按鈕）剛好先寫入：唯一鍵擋下 → 視為已發放
      if (!isUniqueViolation(e)) throw e
      skipped.push({ userId: g.userId, name: g.name, at: new Date(), source: "CONCURRENT", byName: null })
    }
  }
  return { year, granted, skipped, ineligible: preview.ineligible }
}

async function getActiveOpening(userId: string) {
  return prisma.annualLeaveGrant.findFirst({
    where: { userId, kind: "OPENING", voidedAt: null },
    select: { id: true, effectiveAt: true },
  })
}

// 新人（或補填到職日）：寫首年，並補齊到目前開放年度
export async function grantOnHire(userId: string, opts: { actorId: string | null; today?: Date }) {
  const today = opts.today ?? todayStartUTCFromTaipei()
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, hireDate: true, terminatedDate: true },
  })
  const created: string[] = []
  if (!user?.hireDate) return { created }
  if (await getActiveOpening(userId)) return { created }

  const lt = await getAnnualLeaveType()
  const hireYear = user.hireDate.getUTCFullYear()
  const p = calcProRataGrant(user.hireDate, lt.defaultDays)
  try {
    await prisma.annualLeaveGrant.create({
      data: {
        userId, kind: "PRORATA", year: hireYear, effectiveAt: user.hireDate, amount: p.amount,
        basis: p.basis, reason: null, source: "HIRE", createdById: opts.actorId,
        periodKey: periodKey("PRORATA", hireYear),
      },
    })
    created.push(periodKey("PRORATA", hireYear))
  } catch (e) {
    if (!isUniqueViolation(e)) throw e
  }

  for (let year = hireYear + 1; year <= openYearFor(today); year++) {
    const r = await grantAnnualForYear(year, { userIds: [userId], source: "HIRE", actorId: opts.actorId })
    if (r.granted.length > 0) created.push(periodKey("ANNUAL", year))
  }
  return { created }
}

// 離職：作廢生效日 >= 離職日的系統發放（離職日起視為離職）
export async function voidGrantsAfterTermination(userId: string, terminatedDate: Date, actorId: string) {
  const targets = await prisma.annualLeaveGrant.findMany({
    where: { userId, voidedAt: null, kind: { in: ["PRORATA", "ANNUAL"] }, effectiveAt: { gte: terminatedDate } },
    select: { id: true, kind: true, year: true, amount: true },
  })
  if (targets.length === 0) return []
  await prisma.annualLeaveGrant.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { voidedAt: new Date(), voidedById: actorId, voidReason: "生效日在離職日之後", periodKey: null },
  })
  return targets
}

export type RecalcChange = {
  periodKey: string
  label: string
  oldId: string | null
  oldAmount: number | null
  newAmount: number | null
  newEffectiveAt: Date | null
  newBasis: GrantBasis | null
}

const labelOf = (key: string) => {
  const [kind, year] = key.split(":")
  return kind === "PRORATA" ? `${year} 到職首年` : `${year} 年度特休`
}

// 依「目前的到職日」算出應有的 PRORATA/ANNUAL，與現有紀錄比對
export async function previewHireDateRecalc(userId: string, today: Date = todayStartUTCFromTaipei()): Promise<RecalcChange[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, hireDate: true, terminatedDate: true },
  })
  if (!user) throw new Error("找不到員工")
  const lt = await getAnnualLeaveType()
  const opening = await getActiveOpening(userId)
  const current = await prisma.annualLeaveGrant.findMany({
    where: { userId, voidedAt: null, kind: { in: ["PRORATA", "ANNUAL"] } },
    select: { id: true, kind: true, year: true, periodKey: true, amount: true, effectiveAt: true, basis: true },
  })
  const overrides = (await loadOverrides(lt.id, [userId])).get(userId) ?? []

  const desired = new Map<string, { amount: number; effectiveAt: Date; basis: GrantBasis }>()
  if (user.hireDate) {
    const hireYear = user.hireDate.getUTCFullYear()
    if (!opening) {
      const p = calcProRataGrant(user.hireDate, lt.defaultDays)
      desired.set(periodKey("PRORATA", hireYear), { amount: p.amount, effectiveAt: user.hireDate, basis: p.basis })
    }
    const maxExisting = Math.max(0, ...current.filter((c) => c.kind === "ANNUAL").map((c) => c.year ?? 0))
    const maxYear = Math.max(openYearFor(today), maxExisting)
    for (let year = hireYear + 1; year <= maxYear; year++) {
      const jan1 = new Date(Date.UTC(year, 0, 1))
      if (annualIneligibleReason(user, year)) continue
      if (opening && opening.effectiveAt >= jan1) continue
      const g = calcAnnualGrant(user.hireDate, year, lt.defaultDays, overrides)
      desired.set(periodKey("ANNUAL", year), { amount: g.amount, effectiveAt: jan1, basis: g.basis })
    }
  }

  // 只有「發放當下的到職日 ≠ 目前到職日」的紀錄才重算；到職日沒變的紀錄（含遷移來的舊算法數字）一律保留。
  // basis 沒記到職日的紀錄無從判斷，視為沒變。另外補上「應有但不存在」的年度。
  const hireIso = user.hireDate ? isoDate(user.hireDate) : null
  const isStale = (c: (typeof current)[number]) => {
    const used = (c.basis as { hireDate?: string } | null)?.hireDate
    return used !== undefined && used !== hireIso
  }
  const changes: RecalcChange[] = []
  const currentBy = new Map(current.map((c) => [c.periodKey!, c]))
  for (const key of new Set([...currentBy.keys(), ...desired.keys()])) {
    const old = currentBy.get(key)
    const want = desired.get(key)
    if (old && !isStale(old)) continue
    if (!old && !want) continue
    changes.push({
      periodKey: key, label: labelOf(key),
      oldId: old?.id ?? null, oldAmount: old?.amount ?? null,
      newAmount: want?.amount ?? null, newEffectiveAt: want?.effectiveAt ?? null, newBasis: want?.basis ?? null,
    })
  }
  return changes.sort((a, b) => a.periodKey.localeCompare(b.periodKey))
}

export async function applyHireDateRecalc(userId: string, actorId: string, reason: string, today: Date = todayStartUTCFromTaipei()) {
  const changes = await previewHireDateRecalc(userId, today)
  await prisma.$transaction(async (tx) => {
    for (const c of changes) {
      if (c.oldId) {
        await tx.annualLeaveGrant.update({
          where: { id: c.oldId },
          data: { voidedAt: new Date(), voidedById: actorId, voidReason: reason, periodKey: null },
        })
      }
      if (c.newAmount !== null && c.newEffectiveAt && c.newBasis) {
        const [kind, year] = c.periodKey.split(":")
        await tx.annualLeaveGrant.create({
          data: {
            userId, kind: kind as "PRORATA" | "ANNUAL", year: Number(year), effectiveAt: c.newEffectiveAt,
            amount: c.newAmount, basis: c.newBasis, reason, source: "RECALC", createdById: actorId, periodKey: c.periodKey,
          },
        })
      }
    }
  })
  return changes
}

export async function listActiveGrants(userId: string) {
  return prisma.annualLeaveGrant.findMany({
    where: { userId, voidedAt: null },
    orderBy: { effectiveAt: "asc" },
    select: { kind: true, effectiveAt: true, amount: true, year: true },
  })
}

function assertHalfStep(amount: number) {
  if (Math.abs(amount * 2 - Math.round(amount * 2)) > 1e-9) throw new Error("天數必須是 0.5 的倍數")
}

export async function addAdjustment(args: { userId: string; effectiveAt: Date; amount: number; reason: string; actorId: string }) {
  const reason = args.reason.trim()
  if (!reason) throw new Error("原因必填")
  if (isNaN(args.amount) || args.amount === 0) throw new Error("數量必須為非 0 數值")
  assertHalfStep(args.amount)
  return prisma.annualLeaveGrant.create({
    data: {
      userId: args.userId, kind: "ADJUSTMENT", year: null, effectiveAt: args.effectiveAt, amount: args.amount,
      basis: { rule: "ADJUSTMENT", text: `HR 調整 ${args.amount > 0 ? "+" : ""}${args.amount} 天（${reason}）` },
      reason, source: "HR_MANUAL", createdById: args.actorId, periodKey: null,
    },
    select: { id: true },
  })
}

export async function setOpening(args: { userId: string; balance: number; at: Date; actorId: string }) {
  if (isNaN(args.balance) || args.balance < 0) throw new Error("期初天數需為非負數")
  assertHalfStep(args.balance)
  return prisma.$transaction(async (tx) => {
    await tx.annualLeaveGrant.updateMany({
      where: { userId: args.userId, kind: "OPENING", voidedAt: null },
      data: { voidedAt: new Date(), voidedById: args.actorId, voidReason: "期初餘額重設" },
    })
    return tx.annualLeaveGrant.create({
      data: {
        userId: args.userId, kind: "OPENING", year: null, effectiveAt: args.at, amount: args.balance,
        basis: { rule: "OPENING", text: `期初餘額 ${args.balance} 天` },
        reason: "HR 設定期初餘額", source: "HR_MANUAL", createdById: args.actorId, periodKey: null,
      },
      select: { id: true },
    })
  })
}

export async function voidGrant(id: string, reason: string, actorId: string) {
  if (!reason.trim()) throw new Error("作廢原因必填")
  const g = await prisma.annualLeaveGrant.findUnique({ where: { id } })
  if (!g) throw new Error("找不到此紀錄")
  if (g.voidedAt) throw new Error("此紀錄已作廢")
  await prisma.annualLeaveGrant.update({
    where: { id },
    data: { voidedAt: new Date(), voidedById: actorId, voidReason: reason.trim(), periodKey: null },
  })
  return { id: g.id, userId: g.userId, kind: g.kind, amount: g.amount }
}
