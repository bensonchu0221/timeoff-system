import { prisma } from "./db"
import { LeaveType } from "@prisma/client"

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

  const isAnnualLeave = leaveType.name.includes("特休") || leaveType.name.toLowerCase().includes("annual")
  const hireDate = user.hireDate || user.createdAt
  const startYear = hireDate.getFullYear()
  const currentYear = new Date().getFullYear()

  let events: Omit<LedgerEvent, "runningBalance">[] = []

  if (isAnnualLeave) {
    let lastKnownOverride: number | null = null;
    for (let y = startYear; y <= currentYear; y++) {
      const override = await prisma.userLeaveBalance.findUnique({
        where: { userId_leaveTypeId_year: { userId, leaveTypeId, year: y } }
      })

      let grantAmount = 0
      if (override) {
        grantAmount = override.totalQuota
        lastKnownOverride = override.totalQuota
      } else if (lastKnownOverride !== null) {
        grantAmount = lastKnownOverride
      } else {
        grantAmount = leaveType.defaultDays
        // Proportional logic for the first year
        if (y === startYear) {
          const hireDayOfYear = Math.floor((hireDate.getTime() - new Date(y, 0, 1).getTime()) / (1000 * 60 * 60 * 24))
          const daysInYear = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365
          const daysWorked = daysInYear - hireDayOfYear
          grantAmount = Math.round((grantAmount * (daysWorked / daysInYear)) * 2) / 2
        }
      }

      if (grantAmount > 0) {
        events.push({
          id: `grant-${y}`,
          date: new Date(y, 0, 1),
          type: "GRANT",
          leaveTypeName: leaveType.name,
          description: `${y}年度額度發放`,
          amount: grantAmount
        })
      }
    }

    const usages = await prisma.leaveRequest.findMany({
      where: { userId, leaveTypeId, status: { in: ["APPROVED", "PENDING"] } }
    })

    for (const req of usages) {
      events.push({
        id: `usage-${req.id}`,
        date: req.startDate, // sorting by startDate
        type: "USAGE",
        leaveTypeName: leaveType.name,
        description: `請假 (${req.startDate.toLocaleDateString('en-CA')}~${req.endDate.toLocaleDateString('en-CA')}) ${req.status === 'PENDING' ? '[待審核]' : ''}`,
        amount: -req.durationDays
      })
    }

  } else {
    // Non-annual leave usually resets every year, so maybe just show current year
    const override = await prisma.userLeaveBalance.findUnique({
      where: { userId_leaveTypeId_year: { userId, leaveTypeId, year: currentYear } }
    })
    const grantAmount = override ? override.totalQuota : leaveType.defaultDays
    
    events.push({
      id: `grant-${currentYear}`,
      date: new Date(currentYear, 0, 1),
      type: "GRANT",
      leaveTypeName: leaveType.name,
      description: `${currentYear}年度額度發放`,
      amount: grantAmount
    })

    const usages = await prisma.leaveRequest.findMany({
      where: { 
        userId, 
        leaveTypeId, 
        status: { in: ["APPROVED", "PENDING"] },
        startDate: {
          gte: new Date(currentYear, 0, 1),
          lt: new Date(currentYear + 1, 0, 1)
        }
      }
    })

    for (const req of usages) {
      events.push({
        id: `usage-${req.id}`,
        date: req.startDate,
        type: "USAGE",
        leaveTypeName: leaveType.name,
        description: `請假 (${req.startDate.toLocaleDateString('en-CA')}~${req.endDate.toLocaleDateString('en-CA')}) ${req.status === 'PENDING' ? '[待審核]' : ''}`,
        amount: -req.durationDays
      })
    }
  }

  // Sort events chronologically
  events.sort((a, b) => a.date.getTime() - b.date.getTime())

  // Calculate running balance
  let currentBalance = 0
  const finalEvents: LedgerEvent[] = []
  
  for (const e of events) {
    currentBalance += e.amount
    finalEvents.push({
      ...e,
      runningBalance: currentBalance
    })
  }

  return finalEvents.reverse() // Return newest first for the timeline UI
}
