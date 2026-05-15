import { prisma } from "./db"
import { PartOfDay, LeaveStatus } from "@prisma/client"
import { startOfYearUTC } from "./date-format"

// 一律以 UTC 解讀日期，避免伺服器時區（UTC vs UTC+8）造成國定假日比對位移
function formatUTCDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, "0")
  const day = String(d.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

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

  const holidayMap = new Map(holidays.map(h => [formatUTCDate(h.date), h.isWorkDay]));

  let workDays = 0;
  let currentDate = new Date(startDate);
  currentDate.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);

  while (currentDate <= end) {
    const dateStr = formatUTCDate(currentDate);
    const dayOfWeek = currentDate.getUTCDay(); // 0 is Sunday, 6 is Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let isWorkDayThisDay = !isWeekend;

    if (holidayMap.has(dateStr)) {
      isWorkDayThisDay = holidayMap.get(dateStr)!; // Override with holiday/make-up day rule
    }

    if (isWorkDayThisDay) {
      workDays++;
    }

    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  if (workDays === 0) return 0;

  if (partOfDay !== "ALL_DAY" && workDays === 1) {
    return 0.5;
  }

  return workDays;
}

// 將完整年度額度依到職日比例折算（首年使用）
// 例：6/1 到職、全年額度 14 → 大約 14 * (214/365) ≈ 8 天，四捨五入到 0.5
function proRataFirstYear(fullQuota: number, hireDate: Date, year: number): number {
  const hireDayOfYear = Math.floor(
    (hireDate.getTime() - startOfYearUTC(year).getTime()) / (1000 * 60 * 60 * 24)
  )
  const daysInYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 366 : 365
  const daysWorked = daysInYear - hireDayOfYear
  return Math.round((fullQuota * (daysWorked / daysInYear)) * 2) / 2
}

export async function getUserLeaveBalance(userId: string, leaveTypeId: string, year: number): Promise<{ total: number, used: number, pending: number, remaining: number }> {
  // 1. Get leave type info
  const leaveType = await prisma.leaveType.findUnique({ where: { id: leaveTypeId }});
  if (!leaveType) throw new Error("Leave type not found");

  const isAnnualLeave = leaveType.name.includes("特休") || leaveType.name.toLowerCase().includes("annual");

  if (isAnnualLeave) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    // 特休一定要有到職日才能算（不可 fallback 到 createdAt，避免老員工被誤算）
    if (!user.hireDate) {
      return { total: 0, used: 0, pending: 0, remaining: 0 };
    }

    const hireDate = user.hireDate;
    const hireYear = hireDate.getFullYear();
    const startYear = hireYear;

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
        // override.totalQuota 代表「個人完整年度應有天數」
        // 若該年正好是到職年，由系統自動套首年比例；sticky 仍以原值往後沿用
        let yearQuota = override.totalQuota;
        if (y === hireYear) {
          yearQuota = proRataFirstYear(override.totalQuota, hireDate, y);
        }
        totalQuotaCumulative += yearQuota;
        lastKnownOverride = override.totalQuota;
      } else if (lastKnownOverride !== null) {
        // Sticky：沿用最近一次設定的個人完整額度（已過到職年，無需再比例）
        totalQuotaCumulative += lastKnownOverride;
      } else {
        // Default：未曾設定個人額度，使用 LeaveType.defaultDays
        let yearQuota = leaveType.defaultDays;
        if (y === hireYear) {
          yearQuota = proRataFirstYear(yearQuota, hireDate, y);
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
        startDate: { lt: startOfYearUTC(year + 1) }
      }
    });

    const pendingLeaves = await prisma.leaveRequest.aggregate({
      _sum: { durationDays: true },
      where: {
        userId,
        leaveTypeId,
        status: "PENDING",
        startDate: { lt: startOfYearUTC(year + 1) }
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
        gte: startOfYearUTC(year),
        lt: startOfYearUTC(year + 1)
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
        gte: startOfYearUTC(year),
        lt: startOfYearUTC(year + 1)
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
