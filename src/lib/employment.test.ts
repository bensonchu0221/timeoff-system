import { describe, it, expect } from "vitest"
import { isTerminated, activeUserWhere } from "./employment"

const d = (s: string) => new Date(`${s}T00:00:00Z`)

describe("isTerminated（terminatedDate = 最後上班日）", () => {
  const today = d("2026-10-20")
  it("沒填 → 在職", () => {
    expect(isTerminated(null, today)).toBe(false)
    expect(isTerminated(undefined, today)).toBe(false)
  })
  it("最後上班日 = 今天 → 當天仍在職", () => expect(isTerminated(d("2026-10-20"), today)).toBe(false))
  it("最後上班日 = 未來 → 在職（提前填）", () => expect(isTerminated(d("2026-10-31"), today)).toBe(false))
  it("最後上班日 = 昨天 → 已離職", () => expect(isTerminated(d("2026-10-19"), today)).toBe(true))
})

describe("activeUserWhere", () => {
  it("在職 = 沒填，或最後上班日 >= 今天", () => {
    const today = d("2026-10-20")
    expect(activeUserWhere(today)).toEqual({ OR: [{ terminatedDate: null }, { terminatedDate: { gte: today } }] })
  })
})
