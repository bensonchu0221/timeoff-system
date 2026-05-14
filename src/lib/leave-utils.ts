import { prisma } from "./db"
import { PartOfDay, LeaveStatus } from "@prisma/client"

export async function calculateDurationDays(startDate: Date, endDate: Date, partOfDay: PartOfDay): Promise<number> {
  // Get all holidays between startDate and endDate
  const holidays = await prisma.holiday.findMany({
    where: {
      date: {
        gte: startDate,
        lte: endDate,
      }
    }
  });

  const holidayMap = new Map(holidays.map(h => [h.date.toISOString().split('T')[0], h.isWorkDay]));

  let workDays = 0;
  let currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (currentDate <= end) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayOfWeek = currentDate.getDay(); // 0 is Sunday, 6 is Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let isWorkDayThisDay = !isWeekend;

    if (holidayMap.has(dateStr)) {
      isWorkDayThisDay = holidayMap.get(dateStr)!; // Override with holiday/make-up day rule
    }

    if (isWorkDayThisDay) {
      workDays++;
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (workDays === 0) return 0;
  
  if (partOfDay !== "ALL_DAY" && workDays === 1) {
    return 0.5;
  }

  return workDays;
}

export async function getUserLeaveBalance(userId: string, leaveTypeId: string, year: number): Promise<{ total: number, used: number, pending: number, remaining: number }> {
  // 1. Get leave type info
  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId }});
  if (!leaveType) throw new Error("Leave type not found");

  const isAnnualLeave = leaveType.name.includes("特休") || leaveType.name.toLowerCase().includes("annual");

  if (isAnnualLeave) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");
    
    const hireDate = user.hireDate || user.createdAt;
    const startYear = hireDate.getFullYear();
    
    let totalQuotaCumulative = 0;
    let lastKnownOverride: number | null = null;

    // Calculate cumulative quota from startYear to requested year
    for (let y = startYear; y <= year; y++) {
      const override = await prisma.userLeaveBalance.findUnique({
        where: {
          userId_leaveTypeId_year: {
            userId,
            leaveTypeId,
            year: y
          }
        }
      });

      if (override) {
        totalQuotaCumulative += override.totalQuota;
        lastKnownOverride = override.totalQuota;
      } else if (lastKnownOverride !== null) {
        // Sticky logic: use the last set personal quota
        totalQuotaCumulative += lastKnownOverride;
      } else {
        // Default logic
        let yearQuota = leaveType.defaultDays;
        
        // Handle proportional for first year
        if (y === startYear && user.hireDate) {
          const hireYear = user.hireDate.getFullYear();
          if (hireYear === y) {
            const hireDayOfYear = Math.floor((user.hireDate.getTime() - new Date(y, 0, 1).getTime()) / (1000 * 60 * 60 * 24));
            const daysInYear = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 366 : 365;
            const daysWorked = daysInYear - hireDayOfYear;
            yearQuota = Math.round((yearQuota * (daysWorked / daysInYear)) * 2) / 2;
          }
        }
        totalQuotaCumulative += yearQuota;
      }
    }

    // Get all-time used days (Approved only) up to the end of the specified year
    const usedLeaves = await prisma.leaveRequest.aggregate({
      _sum: { durationDays: true },
      where: {
        userId,
        leaveTypeId,
        status: "APPROVED",
        startDate: { lt: new Date(year + 1, 0, 1) }
      }
    });

    const pendingLeaves = await prisma.leaveRequest.aggregate({
      _sum: { durationDays: true },
      where: {
        userId,
        leaveTypeId,
        status: "PENDING",
        startDate: { lt: new Date(year + 1, 0, 1) }
      }
    });

    const usedCumulative = usedLeaves._sum.durationDays || 0;
    const pendingCumulative = pendingLeaves._sum.durationDays || 0;
    const remaining = totalQuotaCumulative - usedCumulative - pendingCumulative;

    return {
      total: totalQuotaCumulative,
      used: usedCumulative,
      pending: pendingCumulative,
      remaining: remaining
    };
  }

  // Non-annual leave: stays the same (resets every year)
  let totalQuota = leaveType.defaultDays;

  const override = await prisma.userLeaveBalance.findUnique({
    where: {
      userId_leaveTypeId_year: { userId, leaveTypeId, year }
    }
  });

  if (override) {
    totalQuota = override.totalQuota;
  }

  const usedLeaves = await prisma.leaveRequest.aggregate({
    _sum: { durationDays: true },
    where: {
      userId,
      leaveTypeId,
      status: "APPROVED",
      startDate: {
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1)
      }
    }
  });

  const pendingLeaves = await prisma.leaveRequest.aggregate({
    _sum: { durationDays: true },
    where: {
      userId,
      leaveTypeId,
      status: "PENDING",
      startDate: {
        gte: new Date(year, 0, 1),
        lt: new Date(year + 1, 0, 1)
      }
    }
  });

  const used = usedLeaves._sum.durationDays || 0;
  const pending = pendingLeaves._sum.durationDays || 0;

  return {
    total: totalQuota,
    used,
    pending,
    remaining: totalQuota - used - pending
  };
}
