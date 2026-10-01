import { prisma } from "./db"
import { formatTaipeiDate, formatTaipeiDateISO, startOfYearUTC } from "./date-format"
import { isAnnualLeaveTypeName } from "./annual-grant-calc"

export type LedgerEvent = {
  id: string
  date: Date
  type: "GRANT" | "USAGE"
  leaveTypeName: string
  description: string
  amount: number
  runningBalance: number
}

export async function getLeaveLedger(userId: string, leaveTypeId: string): Promise<LedgerEvent[]> {
  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } })
  if (!leaveType) throw new Error("Leave type not found")

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error("User not found")

  const isAnnualLeave = isAnnualLeaveTypeName(leaveType.name)
  const now = new Date()

  const events: Omit<LedgerEvent, "runningBalance">[] = []

  if (isAnnualLeave) {
    if (!user.hireDate) return []

    const grants = await prisma.annualLeaveGrant.findMany({
      where: { userId, voidedAt: null },
      orderBy: { effectiveAt: "asc" },
      select: { id: true, kind: true, effectiveAt: true, amount: true, basis: true },
    })
    const opening = grants.find((g) => g.kind === "OPENING")
    for (const g of grants) {
      if (g.effectiveAt > now) continue // 未生效不顯示（明年發放在餘額卡片另行提示）
      const text = (g.basis as { text?: string } | null)?.text ?? `${g.kind} ${g.amount} 天`
      events.push({
        id: `grant-${g.id}`,
        date: g.effectiveAt,
        type: g.amount >= 0 ? "GRANT" : "USAGE",
        leaveTypeName: leaveType.name,
        description: text,
        amount: g.amount,
      })
    }

    // 已請假紀錄：期初之前的不顯示（已抵銷在期初內）
    const usages = await prisma.leaveRequest.findMany({
      where: {
        userId, leaveTypeId, status: { in: ["APPROVED", "PENDING"] },
        ...(opening ? { startDate: { gte: opening.effectiveAt } } : {}),
      },
    })
    for (const req of usages) {
      events.push({
        id: `usage-${req.id}`,
        date: req.startDate,
        type: "USAGE",
        leaveTypeName: leaveType.name,
        description: `請假 (${formatTaipeiDateISO(req.startDate)}~${formatTaipeiDateISO(req.endDate)}) ${req.status === "PENDING" ? "[待審核]" : ""}`.trim(),
        amount: -req.durationDays,
      })
    }
  } else {
    // 非特休：曆年制（1/1 ～ 12/31），不管有無 hireDate
    const currentYear = now.getUTCFullYear()
    const override = await prisma.userLeaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId, year: currentYear } },
    })
    const grantAmount = override ? override.totalQuota : leaveType.defaultDays

    events.push({
      id: `grant-${currentYear}`,
      date: startOfYearUTC(currentYear),
      type: "GRANT",
      leaveTypeName: leaveType.name,
      description: `${currentYear}年度額度發放`,
      amount: grantAmount,
    })

    const usages = await prisma.leaveRequest.findMany({
      where: {
        userId, leaveTypeId,
        status: { in: ["APPROVED", "PENDING"] },
        startDate: { gte: startOfYearUTC(currentYear), lt: startOfYearUTC(currentYear + 1) },
      },
    })
    for (const req of usages) {
      events.push({
        id: `usage-${req.id}`,
        date: req.startDate,
        type: "USAGE",
        leaveTypeName: leaveType.name,
        description: `請假\n${formatTaipeiDate(req.startDate)} ~ ${formatTaipeiDate(req.endDate)} ${req.status === "PENDING" ? "[待審核]" : ""}`,
        amount: -req.durationDays,
      })
    }
  }

  // 依時間正序排序，計算 running balance；最後反轉成「新→舊」給 UI
  events.sort((a, b) => a.date.getTime() - b.date.getTime())

  let currentBalance = 0
  const finalEvents: LedgerEvent[] = []
  for (const e of events) {
    currentBalance += e.amount
    finalEvents.push({ ...e, runningBalance: currentBalance })
  }
  return finalEvents.reverse()
}
