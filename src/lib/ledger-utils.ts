import { prisma } from "./db"
import { formatTaipeiDate, formatTaipeiDateISO, startOfYearUTC } from "./date-format"
import { getAnniversaryBaseDays, monthsBetween, addYearsUTC } from "./leave-utils"

export type LedgerEvent = {
  id: string
  date: Date
  type: "GRANT" | "USAGE"
  leaveTypeName: string
  description: string
  amount: number
  runningBalance: number
}

// 工具：hireDate + N 個月，同日 UTC
function addMonthsUTC(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()))
}

// 對給定的週年期 N，依分水嶺式 override 算出該期實際發放天數
function getAnniversaryActualDays(
  N: number,
  hireYear: number,
  leaveTypeDefaultDays: number,
  overrides: { year: number; totalQuota: number }[]
): number {
  const base = getAnniversaryBaseDays(N, leaveTypeDefaultDays)
  const anniversaryStartYear = hireYear + (N - 1)
  let applicable: number | null = null
  for (const o of overrides) {
    if (o.year <= anniversaryStartYear) applicable = o.totalQuota
    else break
  }
  return applicable !== null ? Math.max(base, applicable) : base
}

export async function getLeaveLedger(userId: string, leaveTypeId: string): Promise<LedgerEvent[]> {
  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId } })
  if (!leaveType) throw new Error("Leave type not found")

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error("User not found")

  const isAnnualLeave = leaveType.name.includes("特休") || leaveType.name.toLowerCase().includes("annual")
  const now = new Date()

  const events: Omit<LedgerEvent, "runningBalance">[] = []

  if (isAnnualLeave) {
    // 特休必須有到職日才能畫 ledger
    if (!user.hireDate) return []

    const hireDate = user.hireDate
    const hireYear = hireDate.getUTCFullYear()
    const M = monthsBetween(hireDate, now)

    // 取所有 override（asc by year，畫每期時做分水嶺挑選）
    const overrides = await prisma.userLeaveBalance.findMany({
      where: { userId, leaveTypeId },
      orderBy: { year: "asc" },
      select: { year: true, totalQuota: true },
    })

    // Opening：兩欄同存才視為有效
    const hasOpening = user.annualLeaveOpeningBalance !== null && user.annualLeaveOpeningAt !== null
    const openingAt = hasOpening ? user.annualLeaveOpeningAt! : null
    const openingBalance = hasOpening ? user.annualLeaveOpeningBalance! : 0

    if (hasOpening && openingAt) {
      // OPENING 事件：替代入職發放事件
      events.push({
        id: `opening`,
        date: openingAt,
        type: "GRANT",
        leaveTypeName: leaveType.name,
        description: `${formatTaipeiDateISO(openingAt)} 系統匯入起始額度 ${openingBalance} 天`,
        amount: openingBalance,
      })
    } else {
      // 無 opening：原本的入職發放事件
      if (M >= 0) {
        const day1Days = getAnniversaryActualDays(1, hireYear, leaveType.defaultDays, overrides)
        events.push({
          id: `grant-anniv-1`,
          date: hireDate,
          type: "GRANT",
          leaveTypeName: leaveType.name,
          description: `入職，特休額度發放 ${day1Days} 天（自滿 3 個月起可申請）`,
          amount: day1Days,
        })
      }

      // 滿 3 個月 marker（無金額；只在無 opening 時顯示）
      if (M >= 3) {
        events.push({
          id: `marker-3m`,
          date: addMonthsUTC(hireDate, 3),
          type: "GRANT",
          leaveTypeName: leaveType.name,
          description: `滿 3 個月，特休開放申請`,
          amount: 0,
        })
      }
    }

    // 已過的每個完整週年（N >= 2）：發放該期額度
    // 有 opening：只畫 grantDate > openingAt 的（之前的已含在 OPENING 裡）
    const completedAnniversaries = Math.floor(M / 12)
    for (let N = 2; N <= completedAnniversaries + 1; N++) {
      const grantDate = addYearsUTC(hireDate, N - 1)
      if (grantDate > now) break
      if (openingAt && grantDate <= openingAt) continue  // 已含在 opening 中

      const seniorityCompleted = N - 1
      const days = getAnniversaryActualDays(N, hireYear, leaveType.defaultDays, overrides)
      events.push({
        id: `grant-anniv-${N}`,
        date: grantDate,
        type: "GRANT",
        leaveTypeName: leaveType.name,
        description: `${formatTaipeiDateISO(grantDate)} 滿 ${seniorityCompleted} 年特休額度新增 ${days} 天`,
        amount: days,
      })
    }

    // 已請假紀錄：opening 之前的不顯示（已抵銷在 OPENING 內）
    const usageWhere: { userId: string; leaveTypeId: string; status: { in: ("APPROVED" | "PENDING")[] }; startDate?: { gte: Date } } = {
      userId,
      leaveTypeId,
      status: { in: ["APPROVED", "PENDING"] },
    }
    if (openingAt) usageWhere.startDate = { gte: openingAt }

    const usages = await prisma.leaveRequest.findMany({ where: usageWhere })
    for (const req of usages) {
      events.push({
        id: `usage-${req.id}`,
        date: req.startDate,
        type: "USAGE",
        leaveTypeName: leaveType.name,
        description: `請假 (${formatTaipeiDateISO(req.startDate)}~${formatTaipeiDateISO(req.endDate)}) ${req.status === "PENDING" ? "[待審核]" : ""}`,
        amount: -req.durationDays,
      })
    }
  } else {
    // 非特休：以 hireDate 為基準的週年制（每期 reset）
    // 沒 hireDate → fallback 曆年制（向後相容）
    if (!user.hireDate) {
      const currentYear = new Date().getUTCFullYear()
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
    } else {
      // 有 hireDate：當前所在週年期 [periodStart, periodEnd)
      const M = monthsBetween(user.hireDate, now)
      const N = Math.floor(M / 12) + 1
      const periodStart = addYearsUTC(user.hireDate, N - 1)
      const periodEnd = addYearsUTC(user.hireDate, N)

      // override 分水嶺式
      const hireYear = user.hireDate.getUTCFullYear()
      const anniversaryStartYear = hireYear + (N - 1)
      const allOverrides = await prisma.userLeaveBalance.findMany({
        where: { userId, leaveTypeId },
        orderBy: { year: "asc" },
        select: { year: true, totalQuota: true },
      })
      let sticky: number | null = null
      for (const o of allOverrides) {
        if (o.year <= anniversaryStartYear) sticky = o.totalQuota
        else break
      }
      const grantAmount = sticky ?? leaveType.defaultDays

      events.push({
        id: `grant-${formatTaipeiDateISO(periodStart)}`,
        date: periodStart,
        type: "GRANT",
        leaveTypeName: leaveType.name,
        description: `${formatTaipeiDateISO(periodStart)} 週年期額度發放 ${grantAmount} 天`,
        amount: grantAmount,
      })

      const usages = await prisma.leaveRequest.findMany({
        where: {
          userId, leaveTypeId,
          status: { in: ["APPROVED", "PENDING"] },
          startDate: { gte: periodStart, lt: periodEnd },
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
