import { prisma } from "./db"
import { formatTaipeiDate, formatTaipeiDateISO, startOfYearUTC } from "./date-format"
import { getStatutoryAnnualDays, monthsBetween, addYearsUTC } from "./leave-utils"

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

function ceilToHalfLocal(n: number): number {
  return Math.ceil(n * 2) / 2
}

function isLeapYearLocal(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInYearLocal(year: number): number {
  return isLeapYearLocal(year) ? 366 : 365
}

function daysFromHireToYearEndLocal(hireDate: Date): number {
  const nextYearStart = Date.UTC(hireDate.getUTCFullYear() + 1, 0, 1)
  return Math.round((nextYearStart - hireDate.getTime()) / 86_400_000)
}

// 分水嶺式 override（year = 曆年）
function resolveCalendarOverride(
  calendarYear: number,
  overrides: { year: number; totalQuota: number }[]
): number | null {
  let applicable: number | null = null
  for (const o of overrides) {
    if (o.year <= calendarYear) applicable = o.totalQuota
    else break
  }
  return applicable
}

// 某 1/1 當天的發放額度（依年資 + override 取大）
function grantForJan1(
  year: number,
  hireDate: Date,
  leaveTypeDefaultDays: number,
  overrides: { year: number; totalQuota: number }[]
): { days: number; completedYears: number } {
  const jan1 = new Date(Date.UTC(year, 0, 1))
  const completedYears = Math.floor(monthsBetween(hireDate, jan1) / 12)
  const base = completedYears < 2
    ? leaveTypeDefaultDays
    : getStatutoryAnnualDays(completedYears)
  const applicable = resolveCalendarOverride(year, overrides)
  const days = applicable !== null ? Math.max(base, applicable) : base
  return { days, completedYears }
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
      // 算式：round((hireDate月份/12) × B + R, 0.5)
      //   B = 個人特休基準天數
      //   R = 2025 未休天數
      // B/R 來自 HR 手動填入（user.annualLeaveOpeningB/R）；若沒填則只顯示公式結構
      const hireMonth = hireDate.getUTCMonth() + 1
      const B = user.annualLeaveOpeningB
      const R = user.annualLeaveOpeningR
      let description = `${formatTaipeiDateISO(openingAt)} 系統匯入起始額度 ${openingBalance} 天`
      if (B !== null && R !== null) {
        // 驗算過程用比較細的精度，方便使用者對照
        const mFraction = hireMonth / 12
        const mTimesB = mFraction * B
        const sum = mTimesB + R
        // 顯示小數點以下 4 位（去尾 0），讓驗算者看清原始未 round 的值
        const fmt = (n: number) => {
          const s = n.toFixed(4)
          return s.replace(/\.?0+$/, "") || "0"
        }
        description += `\n\n公式：round((${hireMonth}/12) × B + R, 0.5)\n= round((${hireMonth}/12) × ${B} + ${R}, 0.5)\n= round(${fmt(mTimesB)} + ${R}, 0.5)\n= round(${fmt(sum)}, 0.5)\n= ${openingBalance} 天`
      } else {
        description += `\n\n公式：round((${hireMonth}/12) × B + R, 0.5)\nB = 個人特休基準天數\nR = 2025 未休天數`
      }
      events.push({
        id: `opening`,
        date: openingAt,
        type: "GRANT",
        leaveTypeName: leaveType.name,
        description,
        amount: openingBalance,
      })
    } else {
      // 無 opening：入職日 pro-rata 發放
      if (M >= 0) {
        const remainingDays = daysFromHireToYearEndLocal(hireDate)
        const yearTotal = daysInYearLocal(hireYear)
        const proRata = ceilToHalfLocal(remainingDays / yearTotal * leaveType.defaultDays)
        events.push({
          id: `grant-hire`,
          date: hireDate,
          type: "GRANT",
          leaveTypeName: leaveType.name,
          description: `入職，特休 pro-rata 發放 ${proRata} 天（${remainingDays}/${yearTotal} × ${leaveType.defaultDays}，自滿 3 個月起可申請）`,
          amount: proRata,
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

    // 每年 1/1 grant 事件：jan1 > openingAt && jan1 <= now
    {
      const startYear = hireYear + 1
      const stopYear = now.getUTCFullYear() + 1
      for (let year = startYear; year < stopYear; year++) {
        const jan1 = new Date(Date.UTC(year, 0, 1))
        if (jan1 > now) break
        if (openingAt && jan1 <= openingAt) continue   // 已含在 OPENING 內
        const { days, completedYears } = grantForJan1(year, hireDate, leaveType.defaultDays, overrides)
        events.push({
          id: `grant-jan1-${year}`,
          date: jan1,
          type: "GRANT",
          leaveTypeName: leaveType.name,
          description: `${year}/01/01 特休額度發放 ${days} 天（年資 ${completedYears} 年）`,
          amount: days,
        })
      }
    }

    // HR 手動調整事件（與 grants 平行，effectiveAt 即事件日期）
    const adjustments = await prisma.leaveAdjustment.findMany({
      where: { userId, leaveTypeId },
      orderBy: { effectiveAt: "asc" },
    })
    for (const adj of adjustments) {
      if (openingAt && adj.effectiveAt <= openingAt) continue   // 已含在 opening 中
      if (adj.effectiveAt > now) continue                       // 未生效不顯示
      const isPositive = adj.amount >= 0
      events.push({
        id: `adjustment-${adj.id}`,
        date: adj.effectiveAt,
        type: isPositive ? "GRANT" : "USAGE",
        leaveTypeName: leaveType.name,
        description: `手動${isPositive ? "補發" : "扣除"} ${Math.abs(adj.amount)} 天（${formatTaipeiDateISO(adj.effectiveAt)} 起生效；原因：${adj.reason}）`,
        amount: adj.amount,
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
