import { prisma } from "@/lib/db"

// 兩階段審核：取得「終審者」（Boss，目前 = Connie）。
// 全公司唯一一人 isFinalApprover=true；找不到時回傳 null（呼叫端需 fail-safe 退回單階段）。
export async function getFinalApprover() {
  return prisma.user.findFirst({
    where: { isFinalApprover: true, terminatedDate: null },
  })
}
