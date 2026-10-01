import { prisma } from "./db"
import { auth } from "@/auth"
import { assertNotImpersonating } from "./impersonation"

// 所有後台寫入 action 共用：從 DB 取最新 role，只允許 ADMIN。
// impersonate 中一律禁止寫入（session.user.id 會被換成目標員工）。
export async function requireAdmin(): Promise<string> {
  await assertNotImpersonating()
  const session = await auth()
  if (!session?.user?.id) throw new Error("Unauthorized")
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true } })
  if (me?.role !== "ADMIN") throw new Error("Forbidden")
  return me.id
}
