import { describe, it, expect, vi, beforeEach } from "vitest"

// mock prisma 整包：避免測試碰到真實 DB
// 之後 calculateDurationDays 內部呼叫 prisma.holiday.findMany 時走 mock
vi.mock("./db", () => ({
  prisma: {
    holiday: {
      findMany: vi.fn(),
    },
  },
}))

import {
  calculateDurationDays,
  getStatutoryAnnualDays,
  monthsBetween,
  addYearsUTC,
  calcCalendarYearCumulative,
  isTaipeiWorkDay,
} from "./leave-utils"
import { prisma } from "./db"

// 工具：建一個 UTC midnight Date
function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

describe("calculateDurationDays", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 預設沒有國定假日
    ;(prisma.holiday.findMany as any).mockResolvedValue([])
  })

  it("單一上班日，全天 = 1", async () => {
    // 2026-05-18 是星期一
    const days = await calculateDurationDays(utcDate("2026-05-18"), utcDate("2026-05-18"), "ALL_DAY")
    expect(days).toBe(1)
  })

  it("單一上班日，半天 = 0.5", async () => {
    const days = await calculateDurationDays(utcDate("2026-05-18"), utcDate("2026-05-18"), "MORNING")
    expect(days).toBe(0.5)
  })

  it("週末選一天 = 0（沒上班日扣不到）", async () => {
    // 2026-05-17 是星期日
    const days = await calculateDurationDays(utcDate("2026-05-17"), utcDate("2026-05-17"), "ALL_DAY")
    expect(days).toBe(0)
  })

  it("週一到週五（含週末會跳過週末）", async () => {
    // 2026-05-18 (Mon) ~ 2026-05-24 (Sun) → 5 個工作日
    const days = await calculateDurationDays(utcDate("2026-05-18"), utcDate("2026-05-24"), "ALL_DAY")
    expect(days).toBe(5)
  })

  it("區間內有國定假日（isWorkDay=false）→ 從天數扣掉", async () => {
    // 5/18 Mon 是國定假日（休一天）
    ;(prisma.holiday.findMany as any).mockResolvedValue([
      { date: utcDate("2026-05-18"), isWorkDay: false, name: "test holiday" },
    ])
    // 5/18 ~ 5/22 (Mon~Fri)，扣掉 5/18 → 4 天
    const days = await calculateDurationDays(utcDate("2026-05-18"), utcDate("2026-05-22"), "ALL_DAY")
    expect(days).toBe(4)
  })

  it("區間內有補班日（isWorkDay=true，假日上班）→ 算進工作天", async () => {
    // 5/16 Sat 補班，本來週末 0 天，加回 1 天
    ;(prisma.holiday.findMany as any).mockResolvedValue([
      { date: utcDate("2026-05-16"), isWorkDay: true, name: "test make-up workday" },
    ])
    // 只選 5/16（補班的週六）→ 1 天
    const days = await calculateDurationDays(utcDate("2026-05-16"), utcDate("2026-05-16"), "ALL_DAY")
    expect(days).toBe(1)
  })

  it("跨週末多日：5/15 Fri ~ 5/19 Tue，扣週末 = 3 天（Fri/Mon/Tue）", async () => {
    const days = await calculateDurationDays(utcDate("2026-05-15"), utcDate("2026-05-19"), "ALL_DAY")
    expect(days).toBe(3)
  })

  it("單日選週末 + 半天 → 0（不能對非工作日請半天）", async () => {
    // 5/17 是週日；雖然 partOfDay=MORNING，但 workDays=0 → 直接回 0
    const days = await calculateDurationDays(utcDate("2026-05-17"), utcDate("2026-05-17"), "MORNING")
    expect(days).toBe(0)
  })

  it("多日請假時，半天設定不會生效（partOfDay 只在單日有效）", async () => {
    // 連 5 個工作日，partOfDay=MORNING 應該還是 5 而不是 4.5
    const days = await calculateDurationDays(utcDate("2026-05-18"), utcDate("2026-05-22"), "MORNING")
    expect(days).toBe(5)
  })

  it("國定假日完全覆蓋區間 → 0 天", async () => {
    ;(prisma.holiday.findMany as any).mockResolvedValue([
      { date: utcDate("2026-05-18"), isWorkDay: false, name: "h1" },
      { date: utcDate("2026-05-19"), isWorkDay: false, name: "h2" },
    ])
    const days = await calculateDurationDays(utcDate("2026-05-18"), utcDate("2026-05-19"), "ALL_DAY")
    expect(days).toBe(0)
  })

  it("連假含補班：補班週六 + 平日假 → 工作天 net 變化", async () => {
    // 5/16 Sat 補班、5/18 Mon 連假
    ;(prisma.holiday.findMany as any).mockResolvedValue([
      { date: utcDate("2026-05-16"), isWorkDay: true, name: "make-up" },
      { date: utcDate("2026-05-18"), isWorkDay: false, name: "holiday" },
    ])
    // 5/16 ~ 5/20 (Sat~Wed)
    // Sat 補班 1 / Sun 0 / Mon 假日 0 / Tue 1 / Wed 1 = 3 天
    const days = await calculateDurationDays(utcDate("2026-05-16"), utcDate("2026-05-20"), "ALL_DAY")
    expect(days).toBe(3)
  })
})

describe("getStatutoryAnnualDays（勞基法 §38 對照表）", () => {
  it("年資 < 2 → 0（fallback，不會走到）", () => {
    expect(getStatutoryAnnualDays(0)).toBe(0)
    expect(getStatutoryAnnualDays(1)).toBe(0)
  })

  it("滿 2 年 = 10 天", () => {
    expect(getStatutoryAnnualDays(2)).toBe(10)
  })

  it("3-4 年 = 14 天", () => {
    expect(getStatutoryAnnualDays(3)).toBe(14)
    expect(getStatutoryAnnualDays(4)).toBe(14)
  })

  it("5-9 年 = 15 天", () => {
    expect(getStatutoryAnnualDays(5)).toBe(15)
    expect(getStatutoryAnnualDays(9)).toBe(15)
  })

  it("10 年 = 16 天（10 年起每年 +1）", () => {
    expect(getStatutoryAnnualDays(10)).toBe(16)
    expect(getStatutoryAnnualDays(11)).toBe(17)
    expect(getStatutoryAnnualDays(15)).toBe(21)
  })

  it("24 年 = 30 天（封頂前最後一階）", () => {
    expect(getStatutoryAnnualDays(24)).toBe(30)
  })

  it("25 年起封頂 30 天", () => {
    expect(getStatutoryAnnualDays(25)).toBe(30)
    expect(getStatutoryAnnualDays(40)).toBe(30)
  })
})

describe("monthsBetween（完整月份數，floor）", () => {
  it("同一天 = 0", () => {
    expect(monthsBetween(utcDate("2024-05-13"), utcDate("2024-05-13"))).toBe(0)
  })

  it("剛好滿 3 個月", () => {
    expect(monthsBetween(utcDate("2024-05-13"), utcDate("2024-08-13"))).toBe(3)
  })

  it("差 1 天還沒滿 3 個月", () => {
    expect(monthsBetween(utcDate("2024-05-13"), utcDate("2024-08-12"))).toBe(2)
  })

  it("剛好滿 1 年", () => {
    expect(monthsBetween(utcDate("2024-05-13"), utcDate("2025-05-13"))).toBe(12)
  })

  it("剛好滿 2 年", () => {
    expect(monthsBetween(utcDate("2024-05-13"), utcDate("2026-05-13"))).toBe(24)
  })

  it("結束日早於起始日 → 0", () => {
    expect(monthsBetween(utcDate("2024-05-13"), utcDate("2024-04-13"))).toBe(0)
  })
})

describe("calcCalendarYearCumulative（曆年制特休累計總額）", () => {
  // 共用：無 adjustment 的空陣列簡寫
  const noAdj: { effectiveAt: Date; amount: number }[] = []

  describe("Describe A：基本 pro-rata + 每年 1/1 發放（無 override）", () => {
    const hire = utcDate("2026-08-05")   // 2026 非閏年（365 天）；hireMonth=8
    const noOverride: { year: number; totalQuota: number }[] = []

    // remainingDays = 149（8/5 到 1/1 next year），proRata = ceilToHalf(149/365×10)=ceilToHalf(4.082)=4.5
    it("入職當天 = 4.5（pro-rata only）", () => {
      expect(calcCalendarYearCumulative(hire, utcDate("2026-08-05"), 10, noOverride, noAdj)).toBe(4.5)
    })

    it("2026-12-31（2027/01/01 尚未到）= 4.5", () => {
      expect(calcCalendarYearCumulative(hire, utcDate("2026-12-31"), 10, noOverride, noAdj)).toBe(4.5)
    })

    it("2027-01-01 = 4.5 + 10 = 14.5（completedYears=0 → defaultDays）", () => {
      expect(calcCalendarYearCumulative(hire, utcDate("2027-01-01"), 10, noOverride, noAdj)).toBe(14.5)
    })

    it("2028-01-01 = 24.5（completedYears=1 < 2 → defaultDays）", () => {
      expect(calcCalendarYearCumulative(hire, utcDate("2028-01-01"), 10, noOverride, noAdj)).toBe(24.5)
    })

    it("2029-01-01 = 34.5（completedYears=2 → statutory 10）", () => {
      expect(calcCalendarYearCumulative(hire, utcDate("2029-01-01"), 10, noOverride, noAdj)).toBe(34.5)
    })

    it("2030-01-01 = 48.5（completedYears=3 → statutory 14）", () => {
      expect(calcCalendarYearCumulative(hire, utcDate("2030-01-01"), 10, noOverride, noAdj)).toBe(48.5)
    })
  })

  describe("Describe A2：邊界 pro-rata 各月（defaultDays=10）", () => {
    const noOverride: { year: number; totalQuota: number }[] = []

    it("2025-01-01 入職 → 365/365×10 = 10", () => {
      const hire = utcDate("2025-01-01")
      expect(calcCalendarYearCumulative(hire, hire, 10, noOverride, noAdj)).toBe(10)
    })

    it("2025-07-01 入職 → 184/365×10 = 5.041 → 5.5", () => {
      const hire = utcDate("2025-07-01")
      expect(calcCalendarYearCumulative(hire, hire, 10, noOverride, noAdj)).toBe(5.5)
    })

    it("2025-08-01 入職 → 153/365×10 = 4.192 → 4.5", () => {
      const hire = utcDate("2025-08-01")
      expect(calcCalendarYearCumulative(hire, hire, 10, noOverride, noAdj)).toBe(4.5)
    })

    it("2025-12-01 入職 → 31/365×10 = 0.849 → 1.0", () => {
      const hire = utcDate("2025-12-01")
      expect(calcCalendarYearCumulative(hire, hire, 10, noOverride, noAdj)).toBe(1.0)
    })

    it("2025-12-31 入職 → 1/365×10 = 0.027 → 0.5", () => {
      const hire = utcDate("2025-12-31")
      expect(calcCalendarYearCumulative(hire, hire, 10, noOverride, noAdj)).toBe(0.5)
    })

    it("2024-02-29 閏年入職 → 307/366×10 = 8.388 → 8.5", () => {
      const hire = utcDate("2024-02-29")
      expect(calcCalendarYearCumulative(hire, hire, 10, noOverride, noAdj)).toBe(8.5)
    })
  })

  describe("Describe B：1/1 發放 + 分水嶺 override（year = 曆年）", () => {
    // Benson 2024-05-13 入職（2024 閏年=366 天），override [{year:2026, totalQuota:15}]
    // remainingDays = 233（5/13 到 1/1 next year），proRata = ceilToHalf(233/366×10)=ceilToHalf(6.366)=6.5
    const hire = utcDate("2024-05-13")
    const overrides = [{ year: 2026, totalQuota: 15 }]

    it("入職當天 = 6.5（pro-rata）", () => {
      expect(calcCalendarYearCumulative(hire, hire, 10, overrides, noAdj)).toBe(6.5)
    })

    it("2025-01-01 = 16.5（completedYears=0 < 2 → 10，無 override）", () => {
      expect(calcCalendarYearCumulative(hire, utcDate("2025-01-01"), 10, overrides, noAdj)).toBe(16.5)
    })

    it("2026-01-01 = 31.5（base=10, override=15 → 15）", () => {
      expect(calcCalendarYearCumulative(hire, utcDate("2026-01-01"), 10, overrides, noAdj)).toBe(31.5)
    })

    it("2027-01-01 = 46.5（completedYears=2 → statutory 10, override=15 → 15）", () => {
      expect(calcCalendarYearCumulative(hire, utcDate("2027-01-01"), 10, overrides, noAdj)).toBe(46.5)
    })

    it("分水嶺不回溯：override {2024:14, 2026:18}，2025 → 14, 2026 → 18", () => {
      const splitOverrides = [
        { year: 2024, totalQuota: 14 },
        { year: 2026, totalQuota: 18 },
      ]
      // proRata 6.5 + 2025 grant 14 + 2026 grant 18 = 38.5
      // 2025: year<=2025 max=2024 → 14；max(10,14)=14
      // 2026: year<=2026 max=2026 → 18；max(10,18)=18
      expect(calcCalendarYearCumulative(hire, utcDate("2026-01-01"), 10, splitOverrides, noAdj)).toBe(38.5)
    })

    it("override 比基準小 → 用基準：override {2027:5}，2027 grant base=10 → 10", () => {
      const smallOverride = [{ year: 2027, totalQuota: 5 }]
      // proRata + 2025(10) + 2026(10) + 2027 max(10, 5)=10 = 6.5 + 30 = 36.5
      expect(calcCalendarYearCumulative(hire, utcDate("2027-01-01"), 10, smallOverride, noAdj)).toBe(36.5)
    })
  })

  describe("Describe C：Opening（資料遷移情境）", () => {
    // Leo 2025-11-03 入職, opening=10.5 @ 2026-01-01，無 override
    const leoHire = utcDate("2025-11-03")
    const leoOpening = { balance: 10.5, at: utcDate("2026-01-01") }

    it("2026-01-01 = 10.5（jan1 == openingAt，not >，不算）", () => {
      expect(calcCalendarYearCumulative(leoHire, utcDate("2026-01-01"), 10, [], noAdj, leoOpening)).toBe(10.5)
    })

    it("2026-12-31 = 10.5（2027/01/01 尚未到）", () => {
      expect(calcCalendarYearCumulative(leoHire, utcDate("2026-12-31"), 10, [], noAdj, leoOpening)).toBe(10.5)
    })

    it("2027-01-01 = 20.5（completedYears=1 < 2 → defaultDays 10）", () => {
      expect(calcCalendarYearCumulative(leoHire, utcDate("2027-01-01"), 10, [], noAdj, leoOpening)).toBe(20.5)
    })

    it("2028-01-01 = 30.5（completedYears=2 → statutory 10）", () => {
      expect(calcCalendarYearCumulative(leoHire, utcDate("2028-01-01"), 10, [], noAdj, leoOpening)).toBe(30.5)
    })

    it("2029-01-01 = 44.5（completedYears=3 → statutory 14）", () => {
      expect(calcCalendarYearCumulative(leoHire, utcDate("2029-01-01"), 10, [], noAdj, leoOpening)).toBe(44.5)
    })

    // Benson opening + override
    const bensonHire = utcDate("2024-05-13")
    const bensonOpening = { balance: 7.5, at: utcDate("2026-01-01") }
    const bensonOverrides = [{ year: 2026, totalQuota: 15 }]

    it("Benson opening + override：2026-04-30 = 7.5（jan1-2026 == openingAt，不加）", () => {
      expect(calcCalendarYearCumulative(bensonHire, utcDate("2026-04-30"), 10, bensonOverrides, noAdj, bensonOpening)).toBe(7.5)
    })

    it("Benson opening + override：2027-01-01 = 22.5（jan1 > opening + override 15）", () => {
      expect(calcCalendarYearCumulative(bensonHire, utcDate("2027-01-01"), 10, bensonOverrides, noAdj, bensonOpening)).toBe(22.5)
    })
  })

  describe("Describe D：手動調整（LeaveAdjustment，per-day effectiveAt）", () => {
    const bensonHire = utcDate("2024-05-13")
    // pro-rata 6.5；2025 grant 10；2026 grant 10

    it("單筆 +2 @ 2026-06-15：未生效（6/14）vs 生效（6/15）", () => {
      const adj = [{ effectiveAt: utcDate("2026-06-15"), amount: 2 }]
      // 6/14：6.5 + 10 + 10 = 26.5（adj 未生效）
      expect(calcCalendarYearCumulative(bensonHire, utcDate("2026-06-14"), 10, [], adj)).toBe(26.5)
      // 6/15：26.5 + 2 = 28.5
      expect(calcCalendarYearCumulative(bensonHire, utcDate("2026-06-15"), 10, [], adj)).toBe(28.5)
    })

    it("多筆 + 負數：[+2@6/15, -0.5@8/1]", () => {
      const adj = [
        { effectiveAt: utcDate("2026-06-15"), amount: 2 },
        { effectiveAt: utcDate("2026-08-01"), amount: -0.5 },
      ]
      // 7/31: +2 生效, -0.5 未生效 → 26.5 + 2 = 28.5
      expect(calcCalendarYearCumulative(bensonHire, utcDate("2026-07-31"), 10, [], adj)).toBe(28.5)
      // 8/1: 兩者皆生效 → 26.5 + 2 - 0.5 = 28
      expect(calcCalendarYearCumulative(bensonHire, utcDate("2026-08-01"), 10, [], adj)).toBe(28)
    })

    it("未生效（effectiveAt > asOf）不算", () => {
      const adj = [{ effectiveAt: utcDate("2027-01-15"), amount: 5 }]
      // asOf=2026-12-31：adj 未生效，不算
      expect(calcCalendarYearCumulative(bensonHire, utcDate("2026-12-31"), 10, [], adj)).toBe(26.5)
    })

    it("opening 互動：effectiveAt <= opening.at 視為已在 opening 內", () => {
      const opening = { balance: 50, at: utcDate("2026-01-01") }
      const adj = [
        { effectiveAt: utcDate("2025-12-15"), amount: 3 },   // 在 opening 前
        { effectiveAt: utcDate("2026-01-01"), amount: 1 },   // 等於 opening.at
        { effectiveAt: utcDate("2026-06-15"), amount: 2 },   // 在 opening 後
      ]
      // 2026-12-31：opening 50 + adj[2] = 52
      expect(calcCalendarYearCumulative(bensonHire, utcDate("2026-12-31"), 10, [], adj, opening)).toBe(52)
      // 2027-01-01：+ jan1-2027 grant 10 → 62
      expect(calcCalendarYearCumulative(bensonHire, utcDate("2027-01-01"), 10, [], adj, opening)).toBe(62)
    })
  })

  describe("Describe E：邊界 case", () => {
    it("asOf < hireDate → 0", () => {
      const hire = utcDate("2026-05-04")
      expect(calcCalendarYearCumulative(hire, utcDate("2026-05-03"), 10, [], noAdj)).toBe(0)
    })

    it("12/31 入職 + 隔天 1/1：0.5 + 10 = 10.5", () => {
      const hire = utcDate("2025-12-31")
      expect(calcCalendarYearCumulative(hire, utcDate("2026-01-01"), 10, [], noAdj)).toBe(10.5)
    })

    it("1/1 入職 + 隔年 1/1：10 + 10 = 20", () => {
      const hire = utcDate("2025-01-01")
      expect(calcCalendarYearCumulative(hire, utcDate("2026-01-01"), 10, [], noAdj)).toBe(20)
    })
  })
})

describe("isTaipeiWorkDay", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prisma.holiday.findMany as any).mockResolvedValue([]) // 預設沒有國定假日
  })

  it("平日（週一）= true", async () => {
    // 2026-07-20 是星期一
    expect(await isTaipeiWorkDay(utcDate("2026-07-20"))).toBe(true)
  })

  it("週六 = false", async () => {
    // 2026-07-25 是星期六
    expect(await isTaipeiWorkDay(utcDate("2026-07-25"))).toBe(false)
  })

  it("週日 = false", async () => {
    // 2026-07-26 是星期日
    expect(await isTaipeiWorkDay(utcDate("2026-07-26"))).toBe(false)
  })

  it("補班日（週六但 Holiday.isWorkDay=true）= true", async () => {
    ;(prisma.holiday.findMany as any).mockResolvedValue([{ isWorkDay: true }])
    expect(await isTaipeiWorkDay(utcDate("2026-07-25"))).toBe(true)
  })

  it("國定假日（平日但 Holiday.isWorkDay=false）= false", async () => {
    ;(prisma.holiday.findMany as any).mockResolvedValue([{ isWorkDay: false }])
    expect(await isTaipeiWorkDay(utcDate("2026-07-20"))).toBe(false)
  })
})

describe("addYearsUTC", () => {
  it("加 1 年同月同日", () => {
    expect(addYearsUTC(utcDate("2024-05-13"), 1).toISOString().slice(0, 10)).toBe("2025-05-13")
  })

  it("加 0 年 = 原日期", () => {
    expect(addYearsUTC(utcDate("2024-05-13"), 0).toISOString().slice(0, 10)).toBe("2024-05-13")
  })

  it("跨閏年 2/29：2/29 → 隔年 3/1（Date 自動 normalize）", () => {
    expect(addYearsUTC(utcDate("2024-02-29"), 1).toISOString().slice(0, 10)).toBe("2025-03-01")
  })
})
