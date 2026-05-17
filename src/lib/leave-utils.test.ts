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

import { calculateDurationDays } from "./leave-utils"
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
