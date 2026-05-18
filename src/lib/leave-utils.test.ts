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
  getAnniversaryBaseDays,
  monthsBetween,
  calcAnnualLeaveCumulative,
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

describe("getAnniversaryBaseDays（每週年期基準天數）", () => {
  // defaultDays = 10（特休的公司前 2 年值）
  it("第 1、2 週年期走公司預設 10 天", () => {
    expect(getAnniversaryBaseDays(1, 10)).toBe(10)
    expect(getAnniversaryBaseDays(2, 10)).toBe(10)
  })

  it("第 3 週年期（年資 2）走政府表 10 天", () => {
    expect(getAnniversaryBaseDays(3, 10)).toBe(10)
  })

  it("第 4 週年期（年資 3）走政府表 14 天", () => {
    expect(getAnniversaryBaseDays(4, 10)).toBe(14)
  })

  it("第 6 週年期（年資 5）走政府表 15 天", () => {
    expect(getAnniversaryBaseDays(6, 10)).toBe(15)
  })

  it("第 11 週年期（年資 10）走政府表 16 天", () => {
    expect(getAnniversaryBaseDays(11, 10)).toBe(16)
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

describe("calcAnnualLeaveCumulative（特休累計總額）", () => {
  describe("Alvin 2026-05-04 入職、無 override", () => {
    const hire = utcDate("2026-05-04")
    const overrides: { year: number; totalQuota: number }[] = []

    it("入職當天 0（未滿 3 個月 gate）", () => {
      expect(calcAnnualLeaveCumulative(hire, utcDate("2026-05-04"), 10, overrides)).toBe(0)
    })

    it("滿 3 個月（2026-08-04）= 10 天", () => {
      expect(calcAnnualLeaveCumulative(hire, utcDate("2026-08-04"), 10, overrides)).toBe(10)
    })

    it("滿 1 年（2027-05-04）= 20 天（第 1 + 第 2 期各 10）", () => {
      expect(calcAnnualLeaveCumulative(hire, utcDate("2027-05-04"), 10, overrides)).toBe(20)
    })

    it("滿 2 年（2028-05-04）= 30 天", () => {
      expect(calcAnnualLeaveCumulative(hire, utcDate("2028-05-04"), 10, overrides)).toBe(30)
    })

    it("滿 3 年（2029-05-04）= 44 天（+14）", () => {
      expect(calcAnnualLeaveCumulative(hire, utcDate("2029-05-04"), 10, overrides)).toBe(44)
    })

    it("滿 5 年（2031-05-04）= 73 天（10+10+10+14+14+15）", () => {
      expect(calcAnnualLeaveCumulative(hire, utcDate("2031-05-04"), 10, overrides)).toBe(73)
    })
  })

  describe("Benson 2024-05-13 入職、入職就 override=14", () => {
    const hire = utcDate("2024-05-13")
    // 一筆 override：year=2024, totalQuota=14
    const overrides = [{ year: 2024, totalQuota: 14 }]

    it("滿 2 年（2026-05-13）= 42（14×3）", () => {
      expect(calcAnnualLeaveCumulative(hire, utcDate("2026-05-13"), 10, overrides)).toBe(42)
    })

    it("滿 3 年（2027-05-13）= 56（14×4）", () => {
      expect(calcAnnualLeaveCumulative(hire, utcDate("2027-05-13"), 10, overrides)).toBe(56)
    })

    it("滿 5 年（2029-05-13）= 84（14×5 + 15，政府勝出）", () => {
      // 14+14+14+14+14+15 = 85... 等等
      // 第 1~5 期 max(基準, 14) = 14 (年資 0,1,2,3,4 → 基準 10,10,10,14,14)
      // 第 6 期 (年資 5) 基準 15 vs override 14 → 15
      // 14+14+14+14+14+15 = 85，不是 84
      expect(calcAnnualLeaveCumulative(hire, utcDate("2029-05-13"), 10, overrides)).toBe(85)
    })
  })

  describe("分水嶺式 override（B 案）", () => {
    // Benson 2024 設 override=14，2026 改 override=18
    const hire = utcDate("2024-05-13")
    const overrides = [
      { year: 2024, totalQuota: 14 },
      { year: 2026, totalQuota: 18 },
    ]

    it("滿 5 年（2029-05-12）= 82（14×2 + 18×3，前 2 期不被追溯）", () => {
      // 第 1 期 (anniversaryYear=2024) → 找 year<=2024 max → 14；max(10,14)=14
      // 第 2 期 (anniversaryYear=2025) → 找 year<=2025 max → 14；max(10,14)=14
      // 第 3 期 (anniversaryYear=2026) → 找 year<=2026 max → 18；max(10,18)=18
      // 第 4 期 (anniversaryYear=2027) → 找 year<=2027 max → 18；max(14,18)=18
      // 第 5 期 (anniversaryYear=2028) → 找 year<=2028 max → 18；max(14,18)=18
      // 注意 2029-05-12 還沒到 2029-05-13，所以 M=59，maxN=5
      expect(calcAnnualLeaveCumulative(hire, utcDate("2029-05-12"), 10, overrides)).toBe(82)
    })

    it("對照：若退化成『最新一筆套全期』會得 18×5=90，本實作不應如此", () => {
      // 此測試與上一個一起防退化（若改成 findFirst desc 會得 90）
      const result = calcAnnualLeaveCumulative(hire, utcDate("2029-05-12"), 10, overrides)
      expect(result).not.toBe(90)
    })
  })

  describe("邊界 case", () => {
    it("hireDate 缺角：未滿 3 個月差 1 天 = 0", () => {
      const hire = utcDate("2026-05-13")
      // 2026-08-12（差 1 天滿 3 個月）→ M=2 → 0
      expect(calcAnnualLeaveCumulative(hire, utcDate("2026-08-12"), 10, [])).toBe(0)
    })

    it("override 比公司基準小（例：override=5, 公司=10）→ 用公司基準", () => {
      const hire = utcDate("2026-05-13")
      const overrides = [{ year: 2026, totalQuota: 5 }]
      // 滿 3 個月，第 1 期 max(10, 5) = 10
      expect(calcAnnualLeaveCumulative(hire, utcDate("2026-08-13"), 10, overrides)).toBe(10)
    })
  })
})
