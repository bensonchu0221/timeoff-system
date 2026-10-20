import { prisma } from "./db"
import { logAudit } from "./audit"
import { todayStartUTCFromTaipei } from "./date-format"
import { activeUserWhere } from "./employment"

// 離職生效（最後上班日已過）後的收尾：解除 LINE 綁定、登出所有裝置（刪 DB session）。
// 由每日 cron 呼叫，HR 補登過去日期時也會立即呼叫；重跑安全（已收尾的會被 where 篩掉）。
export async function offboardTerminatedUsers(
  opts: { userIds?: string[]; today?: Date } = {}
): Promise<{ userId: string; name: string | null; lineUnbound: boolean; sessionsDeleted: number }[]> {
  const today = opts.today ?? todayStartUTCFromTaipei()
  const users = await prisma.user.findMany({
    where: {
      terminatedDate: { lt: today },
      ...(opts.userIds ? { id: { in: opts.userIds } } : {}),
      OR: [{ lineUserId: { not: null } }, { lineBindingCode: { not: null } }, { sessions: { some: {} } }],
    },
    select: { id: true, name: true, lineUserId: true },
  })

  const results = []
  for (const u of users) {
    const [, deleted] = await prisma.$transaction([
      prisma.user.update({
        where: { id: u.id },
        data: { lineUserId: null, lineBindingCode: null, lineBindingExpiry: null, lineBoundAt: null },
      }),
      prisma.session.deleteMany({ where: { userId: u.id } }),
    ])
    const r = { userId: u.id, name: u.name, lineUnbound: !!u.lineUserId, sessionsDeleted: deleted.count }
    // 系統動作沒有操作者；actorId 記員工本人，payload 標明來源
    await logAudit({
      actorId: u.id,
      action: "USER_OFFBOARD",
      targetType: "User",
      targetId: u.id,
      payload: { source: "SYSTEM", lineUnbound: r.lineUnbound, sessionsDeleted: r.sessionsDeleted },
    })
    results.push(r)
  }
  return results
}

// 已離職但還卡著東西的人：仍有在職下屬，或仍是某張待審假單的「當前審核者」。
// 沒處理會讓下屬的假單送不出去 / 卡住沒人審，所以每天提醒 HR 直到改派完成。
export async function findTerminatedWithLooseEnds(today: Date = todayStartUTCFromTaipei()) {
  const terminated = await prisma.user.findMany({
    where: { terminatedDate: { lt: today } },
    select: { id: true, name: true },
  })
  if (terminated.length === 0) return []
  const ids = terminated.map((u) => u.id)

  const subs = await prisma.user.groupBy({
    by: ["managerId"],
    where: { managerId: { in: ids }, ...activeUserWhere(today) },
    _count: { _all: true },
  })
  const pending = await prisma.leaveRequest.findMany({
    where: {
      status: "PENDING",
      OR: [
        { firstApprovedAt: null, approverId: { in: ids } },
        { firstApprovedAt: { not: null }, secondApproverId: { in: ids } },
      ],
    },
    select: { approverId: true, secondApproverId: true, firstApprovedAt: true },
  })

  const subCount = new Map(subs.map((s) => [s.managerId!, s._count._all]))
  const pendingCount = new Map<string, number>()
  for (const p of pending) {
    const reviewer = p.firstApprovedAt ? p.secondApproverId : p.approverId
    if (reviewer) pendingCount.set(reviewer, (pendingCount.get(reviewer) || 0) + 1)
  }
  return terminated
    .map((u) => ({ ...u, subordinates: subCount.get(u.id) || 0, pendingReviews: pendingCount.get(u.id) || 0 }))
    .filter((u) => u.subordinates > 0 || u.pendingReviews > 0)
}
