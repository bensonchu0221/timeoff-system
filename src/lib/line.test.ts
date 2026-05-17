import { describe, it, expect } from "vitest"
import crypto from "crypto"
import {
  shouldSendLine,
  isBalanceQuery,
  verifyLineSignature,
  generateBindingCode,
  PRESET_REJECT_REASONS,
} from "./line"

describe("shouldSendLine", () => {
  const user = (lineUserId: string | null, prefs: any) => ({
    lineUserId,
    lineNotifyPrefs: prefs,
  })

  it("沒綁 LINE → 一律 false", () => {
    expect(shouldSendLine(user(null, {}), "reviewResult")).toBe(false)
    expect(shouldSendLine(user(null, { reviewResult: true }), "reviewResult")).toBe(false)
  })

  it("綁了但 prefs 為 null → 預設全 true", () => {
    expect(shouldSendLine(user("U123", null), "reviewResult")).toBe(true)
    expect(shouldSendLine(user("U123", undefined), "reviewResult")).toBe(true)
  })

  it("綁了且 prefs 內該 key 未設定 → 預設 true（undefined 不算關）", () => {
    expect(shouldSendLine(user("U123", { otherKey: false }), "reviewResult")).toBe(true)
  })

  it("綁了且 prefs 該 key 為 false → 不推", () => {
    expect(shouldSendLine(user("U123", { reviewResult: false }), "reviewResult")).toBe(false)
  })

  it("綁了且 prefs 該 key 為 true → 推", () => {
    expect(shouldSendLine(user("U123", { reviewResult: true }), "reviewResult")).toBe(true)
  })

  it("user 為 null/undefined → false（不會炸）", () => {
    expect(shouldSendLine(null, "reviewResult")).toBe(false)
    expect(shouldSendLine(undefined, "reviewResult")).toBe(false)
  })
})

describe("isBalanceQuery", () => {
  it("白名單關鍵字命中", () => {
    expect(isBalanceQuery("查假")).toBe(true)
    expect(isBalanceQuery("我的假")).toBe(true)
    expect(isBalanceQuery("剩多少假")).toBe(true)
    expect(isBalanceQuery("假")).toBe(true)
  })

  it("前後空白會被 trim 後再比對", () => {
    expect(isBalanceQuery("  查假  ")).toBe(true)
    expect(isBalanceQuery("\t查假\n")).toBe(true)
  })

  it("非白名單字 → false", () => {
    expect(isBalanceQuery("hello")).toBe(false)
    expect(isBalanceQuery("查 假")).toBe(false) // 中間有空白不算
    expect(isBalanceQuery("查假呢")).toBe(false) // 多字
    expect(isBalanceQuery("")).toBe(false)
  })

  it("大小寫敏感（中文沒差，但確保 default 行為）", () => {
    // 主要避免有人之後加英文關鍵字時誤以為不分大小寫
    expect(isBalanceQuery("查假")).toBe(true)
  })
})

describe("verifyLineSignature", () => {
  const SECRET = "test-channel-secret"

  function sign(body: string): string {
    return crypto.createHmac("sha256", SECRET).update(body).digest("base64")
  }

  it("正確簽章 → true", () => {
    const body = JSON.stringify({ events: [{ type: "follow" }] })
    expect(verifyLineSignature(body, sign(body))).toBe(true)
  })

  it("錯誤簽章 → false", () => {
    const body = JSON.stringify({ events: [{ type: "follow" }] })
    expect(verifyLineSignature(body, "wrong-signature-aaaa")).toBe(false)
  })

  it("body 被竄改 → 簽章驗證失敗", () => {
    const original = JSON.stringify({ events: [{ type: "follow" }] })
    const tamperedBody = JSON.stringify({ events: [{ type: "message" }] })
    expect(verifyLineSignature(tamperedBody, sign(original))).toBe(false)
  })

  it("簽章 header 為空字串 → false（不會誤通過）", () => {
    const body = "{}"
    expect(verifyLineSignature(body, "")).toBe(false)
  })

  it("簽章長度怪異 → 不會 throw（timingSafeEqual catch 過）", () => {
    // 故意給短簽章看會不會炸
    expect(() => verifyLineSignature("{}", "abc")).not.toThrow()
    expect(verifyLineSignature("{}", "abc")).toBe(false)
  })
})

describe("generateBindingCode", () => {
  it("長度為 6", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateBindingCode()).toHaveLength(6)
    }
  })

  it("字元集只含 23456789ABCDEFGHJKLMNPQRSTUVWXYZ（避開易混淆字）", () => {
    const allowed = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/
    for (let i = 0; i < 200; i++) {
      const code = generateBindingCode()
      expect(allowed.test(code)).toBe(true)
    }
  })

  it("產出的 code 不含 0 / O / 1 / I（避免員工混淆）", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateBindingCode()
      expect(code).not.toMatch(/[0O1I]/)
    }
  })

  it("隨機性合理：跑 100 次至少出現多種開頭字元", () => {
    const firstChars = new Set<string>()
    for (let i = 0; i < 100; i++) {
      firstChars.add(generateBindingCode()[0])
    }
    // 字元集有 32 種，100 次至少該有 5 種不同開頭（若 < 5 表示 random 壞掉）
    expect(firstChars.size).toBeGreaterThanOrEqual(5)
  })
})

describe("PRESET_REJECT_REASONS", () => {
  it("第一個一定是「直接駁回（不附理由）」對應空字串", () => {
    expect(PRESET_REJECT_REASONS[0].reason).toBe("")
  })

  it("每筆都有 label + reason 兩個欄位", () => {
    for (const r of PRESET_REJECT_REASONS) {
      expect(typeof r.label).toBe("string")
      expect(r.label.length).toBeGreaterThan(0)
      expect(typeof r.reason).toBe("string")
    }
  })

  it("除了「不附理由」外，其餘 reason 都不能是空字串", () => {
    for (let i = 1; i < PRESET_REJECT_REASONS.length; i++) {
      expect(PRESET_REJECT_REASONS[i].reason.length).toBeGreaterThan(0)
    }
  })

  it("reason 不含 & 或 = 等會破壞 postback data 解析的字元", () => {
    for (const r of PRESET_REJECT_REASONS) {
      expect(r.reason).not.toMatch(/[&=]/)
    }
  })
})
