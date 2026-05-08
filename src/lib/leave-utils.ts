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

export async function getUserLeaveBalance(userId: string, leaveTypeId: string, year: number): Promise<{ total: number, used: number, remaining: number }> {
  // 1. Get default quota for this leave type
  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId }});
  if (!leaveType) throw new Error("Leave type not found");

  let totalQuota = leaveType.defaultDays;

  // 2. Check for user-specific override
  const override = await prisma.userLeaveBalance.findUnique({
    where: {
      userId_leaveTypeId_year: {
        userId,
        leaveTypeId,
        year
      }
    }
  });

  if (override) {
    totalQuota = override.totalQuota;
  } else {
    // If it's Annual Leave ("特休"), calculate proportional if user is new hire
    if (leaveType.name.includes("特休")) {
      const user = await prisma.user.findUnique({ where: { id: userId }});
      if (user && user.hireDate) {
        const hireYear = user.hireDate.getFullYear();
        if (hireYear === year) {
          // Proportional calculation for the first year
          const hireDayOfYear = Math.floor((user.hireDate.getTime() - new Date(year, 0, 1).getTime()) / (1000 * 60 * 60 * 24));
          const daysInYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365;
          const daysWorked = daysInYear - hireDayOfYear;
          totalQuota = Math.round((totalQuota * (daysWorked / daysInYear)) * 2) / 2; // Round to nearest 0.5
        }
      }
    }
  }

  // 3. Get used days (Approved leaves only)
  const usedLeaves = await prisma.leaveRequest.aggregate({
    _sum: {
      durationDays: true
    },
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

  const used = usedLeaves._sum.durationDays || 0;
  return {
    total: totalQuota,
    used,
    remaining: totalQuota - used
  };
}
