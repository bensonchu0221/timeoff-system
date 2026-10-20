import type { Prisma } from "@prisma/client"
import { todayStartUTCFromTaipei } from "./date-format"

// User.terminatedDate = 最後上班日：當天（台北）仍算在職，隔天 00:00 起才算離職。
// HR 一收到離職通知就能先填，到期自動生效；所有「是否離職」判斷一律走這兩個 helper。

export function isTerminated(
  terminatedDate: Date | null | undefined,
  today: Date = todayStartUTCFromTaipei()
): boolean {
  return !!terminatedDate && terminatedDate < today
}

// 查詢用：在職 = 沒填最後上班日，或最後上班日還沒過
export function activeUserWhere(today: Date = todayStartUTCFromTaipei()): Prisma.UserWhereInput {
  return { OR: [{ terminatedDate: null }, { terminatedDate: { gte: today } }] }
}
