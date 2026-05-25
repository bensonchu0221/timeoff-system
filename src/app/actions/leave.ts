"use server"

import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { calculateDurationDays, getUserLeaveBalance, monthsBetween } from "@/lib/leave-utils"
import { todayStartUTCFromTaipei } from "@/lib/date-format"
import { logAudit } from "@/lib/audit"
import { PartOfDay, LeaveStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import {
  sendLeaveApplicationEmail,
  sendLeaveResultEmail,
  sendDepartmentLeaveEmail,
  sendLeaveCancelledEmail,
  sendLeaveUpdatedEmail,
  sendBackupAssignedEmail,
  sendBackupRemovedEmail,
  sendBossReviewEmail,
  sendFirstApprovedEmail,
  displayName,
} from "@/lib/email"
import {
  shouldSendLine,
  sendLineLeaveApplication,
  sendLineLeaveResult,
  sendLineSameDepartment,
  sendLineLeaveCancelled,
  sendLineLeaveUpdated,
  sendLineBackupAssigned,
  sendLineBackupRemoved,
  sendLineBossReview,
  sendLineFirstApproved,
} from "@/lib/line"
import { getFinalApprover } from "@/lib/approval"
import { assertNotImpersonating } from "@/lib/impersonation"

export async function applyLeave(data: {
  leaveTypeId: string,
  startDate: string,
  endDate: string,
  partOfDay: PartOfDay,
  reason?: string,
  backupId?: string | null
}) {
  await assertNotImpersonating()
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const userId = session.user.id;
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);

  if (start > end) return { error: "Start date cannot be after end date" };

  // Check for overlapping leaves
  const overlappingLeaves = await prisma.leaveRequest.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "APPROVED"] },
      OR: [
        // overlap condition: (new_start <= existing_end) AND (new_end >= existing_start)
        {
          startDate: { lte: end },
          endDate: { gte: start }
        }
      ]
    }
  });

  if (overlappingLeaves.length > 0) {
    return { error: "此時間區間您已經有申請過假單（待審核或已核准），請勿重複申請！" };
  }

  const durationDays = await calculateDurationDays(start, end, data.partOfDay);
  if (durationDays === 0) return { error: "請假天數不可為 0（您可能全選到了週末或國定假日）" };

  // 提前抓假別名稱：錯誤訊息要用，後面寄信也要用
  const leaveTypeObj = await prisma.leaveType.findUnique({ where: { id: data.leaveTypeId } });
  const leaveTypeName = leaveTypeObj?.name || "該假別";

  // 先 fetch user：特休 3 個月 gate 與 manager 都要用（審核路由在下方計算）
  const user = await prisma.user.findUnique({ where: { id: userId } });

  // 生理假 gate：男性不得申請
  if (user?.gender === "MALE" && leaveTypeObj?.name.includes("生理假")) {
    return { error: "男性員工無法申請生理假。" };
  }

  // 特休 gate：到職滿 3 個月才能請特休（公司政策）
  const isAnnual = leaveTypeObj && (leaveTypeObj.name.includes("特休") || leaveTypeObj.name.toLowerCase().includes("annual"));
  if (isAnnual && user?.hireDate && monthsBetween(user.hireDate, start) < 3) {
    return { error: `${leaveTypeName}需到職滿 3 個月後才能申請。` };
  }

  // 額度檢查：以請假開始日當 asOf，計算當下的累計可請額度
  const balance = await getUserLeaveBalance(userId, data.leaveTypeId, start);

  if (durationDays > balance.remaining) {
    return { error: `${leaveTypeName}不足！您嘗試申請 ${durationDays} 天，但目前 ${leaveTypeName} 只剩 ${balance.remaining} 天可請（包含審核中假單）。` };
  }

  // 代理人驗證：選填，若有填要是真的存在的在職員工、且不是自己
  let backupId: string | null = data.backupId || null;
  if (backupId === userId) backupId = null;
  if (backupId) {
    const backup = await prisma.user.findUnique({ where: { id: backupId } });
    if (!backup || backup.terminatedDate) backupId = null;
  }

  // 兩階段審核路由：決定一審者(approverId) / 二審者(secondApproverId) / 是否自動核准。
  // finalApprover = 全公司唯一的終審者（Boss）。
  const finalApprover = await getFinalApprover()
  const finalApproverId = finalApprover?.id ?? null
  const managerId = user?.managerId ?? null

  let approverId: string | null = managerId   // 一審者，預設為直屬主管
  let secondApproverId: string | null = null  // 二審者；null = 不需二審（單階段）
  let autoApprove = false                      // 終審者本人送單 → 自動核准

  if (finalApproverId && userId === finalApproverId) {
    // 終審者本人送單：沒有上層可審 → 自動核准
    autoApprove = true
    approverId = null
  } else if (finalApproverId) {
    if (!managerId || managerId === finalApproverId) {
      // 沒主管，或主管本身就是終審者 → 單階段，由終審者擔任唯一審核者
      approverId = finalApproverId
      secondApproverId = null
    } else {
      // 標準兩階段：主管一審 → 終審者二審
      approverId = managerId
      secondApproverId = finalApproverId
    }
  }
  // finalApproverId 為 null（尚未設定終審者）→ fail-safe：維持原單階段（approverId = managerId）

  const leaveRequest = await prisma.leaveRequest.create({
    data: {
      userId,
      leaveTypeId: data.leaveTypeId,
      startDate: start,
      endDate: end,
      partOfDay: data.partOfDay,
      reason: data.reason,
      durationDays,
      status: autoApprove ? "APPROVED" : "PENDING",
      approverId,
      secondApproverId,
      backupId,
    }
  });

  await logAudit({
    actorId: userId,
    action: autoApprove ? "LEAVE_AUTO_APPROVE" : "LEAVE_APPLY",
    targetType: "LeaveRequest",
    targetId: leaveRequest.id,
    payload: {
      leaveTypeId: data.leaveTypeId,
      startDate: data.startDate,
      endDate: data.endDate,
      durationDays,
    },
  })

  const applicantName = displayName(user?.name, user?.chineseName);

  if (autoApprove) {
    // 終審者本人 → 直接核准：通知同部門 + 代理人（已核准）。申請人是本人，不另通知結果。
    await sendApprovedNotifications({
      applicantUserId: userId,
      applicantName,
      departmentId: user?.departmentId ?? null,
      leaveTypeName,
      start,
      end,
      partOfDay: data.partOfDay,
      durationDays,
      backupId,
    })
  } else {
    // 通知一審者（主管，或單階段時的終審者）
    if (approverId) {
      const manager = await prisma.user.findUnique({ where: { id: approverId } });
      const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:8080";
      const reviewLink = `${siteUrl}/admin/approvals`;

      if (manager?.email) {
        await sendLeaveApplicationEmail(
          manager.email,
          applicantName,
          leaveTypeName,
          start,
          end,
          data.partOfDay,
          durationDays,
          reviewLink
        );
      }
      // LINE 通知：依主管的 applicationToManager 偏好決定是否推
      if (shouldSendLine(manager, "applicationToManager")) {
        await sendLineLeaveApplication(
          manager!.lineUserId!,
          applicantName,
          leaveTypeName,
          durationDays,
          reviewLink,
          leaveRequest.id
        );
      }
    }

    // 代理人通知（選填；申請時尚未核准 = PENDING）
    if (backupId) {
      await notifyBackupAssigned(backupId, applicantName, leaveTypeName, start, end, data.partOfDay, durationDays, "PENDING")
    }
  }

  revalidatePath("/dashboard")
  return { success: true, request: leaveRequest }
}

// 兩階段審核：最終核准後的共用通知（同部門 + 代理人「已核准」）。
// 用於：reviewLeaveAsUser 的最終核准，以及 applyLeave 的終審者自動核准。
async function sendApprovedNotifications(args: {
  applicantUserId: string,
  applicantName: string,
  departmentId: string | null,
  leaveTypeName: string,
  start: Date,
  end: Date,
  partOfDay: string,
  durationDays: number,
  backupId: string | null,
}) {
  const { applicantUserId, applicantName, departmentId, leaveTypeName, start, end, partOfDay, durationDays, backupId } = args

  // 同部門通知：提醒同部門同事誰會請假
  if (departmentId) {
    const teammates = await prisma.user.findMany({
      where: { departmentId, terminatedDate: null, id: { not: applicantUserId } },
      select: { email: true, lineUserId: true, lineNotifyPrefs: true },
    })
    await Promise.allSettled(teammates.flatMap((t) => {
      const tasks: Promise<unknown>[] = []
      if (t.email) tasks.push(sendDepartmentLeaveEmail(t.email, applicantName, leaveTypeName, start, end, partOfDay, durationDays))
      if (shouldSendLine(t, "departmentLeave")) tasks.push(sendLineSameDepartment(t.lineUserId!, applicantName, leaveTypeName, start, end))
      return tasks
    }))
  }

  // 代理人正式生效
  if (backupId) {
    await notifyBackupAssigned(backupId, applicantName, leaveTypeName, start, end, partOfDay, durationDays, "APPROVED")
  }
}

// ----- 通知 helpers（在 actions 內共用，呼叫 email + LINE）-----

async function notifyBackupAssigned(
  backupUserId: string,
  applicantName: string,
  leaveType: string,
  start: Date,
  end: Date,
  partOfDay: string,
  durationDays: number,
  status: "PENDING" | "APPROVED"
) {
  const backup = await prisma.user.findUnique({
    where: { id: backupUserId },
    select: { email: true, lineUserId: true, lineNotifyPrefs: true },
  })
  if (!backup) return
  if (backup.email) {
    await sendBackupAssignedEmail(backup.email, applicantName, leaveType, start, end, partOfDay, durationDays, status)
  }
  if (shouldSendLine(backup, "backupAssigned")) {
    await sendLineBackupAssigned(backup.lineUserId!, applicantName, leaveType, start, end, status)
  }
}

async function notifyBackupRemoved(
  backupUserId: string,
  applicantName: string,
  leaveType: string,
  start: Date,
  end: Date,
  partOfDay: string,
  durationDays: number,
  reason: "REMOVED_BY_EDIT" | "CANCELLED" | "REJECTED"
) {
  const backup = await prisma.user.findUnique({
    where: { id: backupUserId },
    select: { email: true, lineUserId: true, lineNotifyPrefs: true },
  })
  if (!backup) return
  if (backup.email) {
    await sendBackupRemovedEmail(backup.email, applicantName, leaveType, start, end, partOfDay, durationDays, reason)
  }
  if (shouldSendLine(backup, "backupAssigned")) {
    await sendLineBackupRemoved(backup.lineUserId!, applicantName, leaveType, start, end, reason)
  }
}

export async function cancelLeave(requestId: string) {
  await assertNotImpersonating()
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { user: true, leaveType: true }
  });
  if (!request) throw new Error("Request not found");

  // 從 DB 抓最新 role，避免 session 中的 role 過時或被竄改
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id } });
  const isAdmin = dbUser?.role === "ADMIN";
  if (request.userId !== session.user.id && !isAdmin) {
    throw new Error("Forbidden");
  }

  if (request.status !== "PENDING" && request.status !== "APPROVED") {
    throw new Error("只能撤銷「待審核」或「已核准」狀態的假單！");
  }

  // 已過開始日的假單不可撤銷（員工實際已經請過，撤銷會憑空退回額度造成補請假漏洞）
  if (request.startDate < todayStartUTCFromTaipei()) {
    throw new Error("此假單的開始日期已過，無法撤銷！如需修正請聯絡管理員。");
  }

  const previousStatus = request.status as "PENDING" | "APPROVED";

  await prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" }
  });

  await logAudit({
    actorId: session.user.id,
    action: "LEAVE_CANCEL",
    targetType: "LeaveRequest",
    targetId: requestId,
    payload: { previousStatus },
  })

  // --- 撤銷通知 ---
  const applicantName = displayName(request.user?.name, request.user?.chineseName)
  const leaveTypeName = request.leaveType.name
  const start = request.startDate
  const end = request.endDate
  const partOfDay = request.partOfDay
  const durationDays = request.durationDays

  // 通知相關審核者：一審主管一律通知；若已進二審（firstApprovedAt 非 null）或原為已核准，
  // 終審者（Boss）也是目前/曾經持有該單的人，一併通知。
  const approverIds = new Set<string>()
  if (request.approverId) approverIds.add(request.approverId)
  if (request.secondApproverId && (request.firstApprovedAt || previousStatus === "APPROVED")) {
    approverIds.add(request.secondApproverId)
  }
  if (approverIds.size > 0) {
    const approvers = await prisma.user.findMany({
      where: { id: { in: [...approverIds] } },
      select: { email: true, lineUserId: true, lineNotifyPrefs: true },
    })
    await Promise.allSettled(approvers.flatMap((a) => {
      const tasks: Promise<unknown>[] = []
      if (a.email) tasks.push(sendLeaveCancelledEmail(a.email, applicantName, leaveTypeName, start, end, partOfDay, durationDays, previousStatus))
      if (shouldSendLine(a, "leaveCancelled")) tasks.push(sendLineLeaveCancelled(a.lineUserId!, applicantName, leaveTypeName, start, end, previousStatus))
      return tasks
    }))
  }

  // 已核准 → 同部門也要通知（原本同部門已通知會請假，現在撤銷了）
  if (previousStatus === "APPROVED" && request.user.departmentId) {
    const teammates = await prisma.user.findMany({
      where: {
        departmentId: request.user.departmentId,
        terminatedDate: null,
        id: { not: request.userId },
      },
      select: { email: true, lineUserId: true, lineNotifyPrefs: true },
    })
    await Promise.allSettled(teammates.flatMap(t => {
      const tasks: Promise<unknown>[] = []
      if (t.email) tasks.push(sendLeaveCancelledEmail(t.email, applicantName, leaveTypeName, start, end, partOfDay, durationDays, previousStatus))
      if (shouldSendLine(t, "leaveCancelled")) tasks.push(sendLineLeaveCancelled(t.lineUserId!, applicantName, leaveTypeName, start, end, previousStatus))
      return tasks
    }))
  }

  // 通知代理人「不用代理了」
  if (request.backupId) {
    await notifyBackupRemoved(request.backupId, applicantName, leaveTypeName, start, end, partOfDay, durationDays, "CANCELLED")
  }

  revalidatePath("/dashboard")
  revalidatePath("/admin/approvals")
  revalidatePath("/gantt")
  return { success: true }
}

export async function updateLeave(requestId: string, data: {
  leaveTypeId: string,
  startDate: string,
  endDate: string,
  partOfDay: PartOfDay,
  reason?: string,
  backupId?: string | null
}) {
  await assertNotImpersonating()
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized" };

  const userId = session.user.id;
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { user: true, leaveType: true },
  });
  if (!request) return { error: "Request not found" };

  // 權限：只有本人可以修改自己的單
  if (request.userId !== userId) return { error: "Forbidden" };

  // 狀態：只能修改 PENDING；已核准的請走「撤銷後重申」
  if (request.status !== "PENDING") {
    return { error: "只能修改「待審核」狀態的假單；已核准請先撤銷再重新申請。" };
  }

  // 時間：startDate 已過去的不能改（避免事後竄改歷史）
  if (request.startDate < todayStartUTCFromTaipei()) {
    return { error: "此假單的開始日期已過，無法修改。" };
  }

  const start = new Date(data.startDate);
  const end = new Date(data.endDate);
  if (start > end) return { error: "Start date cannot be after end date" };
  if (start < todayStartUTCFromTaipei()) {
    return { error: "請假開始日期不可早於今天。" };
  }

  // 排除自己這張，重新檢查是否與其他單重疊
  const overlappingLeaves = await prisma.leaveRequest.findMany({
    where: {
      userId,
      id: { not: requestId },
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: end },
      endDate: { gte: start }
    }
  });
  if (overlappingLeaves.length > 0) {
    return { error: "此時間區間您已經有另一張假單，請避開重疊區間。" };
  }

  const newDuration = await calculateDurationDays(start, end, data.partOfDay);
  if (newDuration === 0) return { error: "請假天數不可為 0（您可能全選到了週末或國定假日）" };

  // 額度檢查：若假別未變，舊單的天數已計入 pending、需加回；若假別改了，新假別的 pending 不含本單
  const leaveTypeChanged = data.leaveTypeId !== request.leaveTypeId;
  const balance = await getUserLeaveBalance(userId, data.leaveTypeId, start);
  const allowedNewDuration = leaveTypeChanged ? balance.remaining : balance.remaining + request.durationDays;
  if (newDuration > allowedNewDuration) {
    const newLeaveType = await prisma.leaveType.findUnique({ where: { id: data.leaveTypeId } });
    const newLeaveTypeName = newLeaveType?.name || "該假別";
    return { error: `${newLeaveTypeName}不足！修改後需要 ${newDuration} 天，但 ${newLeaveTypeName} 目前最多可改為 ${allowedNewDuration} 天。` };
  }

  // 代理人變更驗證：選填，不能是自己；要是在職員工
  let newBackupId: string | null = data.backupId === undefined ? request.backupId : (data.backupId || null);
  if (newBackupId === userId) newBackupId = null;
  if (newBackupId && newBackupId !== request.backupId) {
    const backup = await prisma.user.findUnique({ where: { id: newBackupId } });
    if (!backup || backup.terminatedDate) newBackupId = null;
  }

  await prisma.leaveRequest.update({
    where: { id: requestId },
    data: {
      leaveTypeId: data.leaveTypeId,
      startDate: start,
      endDate: end,
      partOfDay: data.partOfDay,
      reason: data.reason,
      durationDays: newDuration,
      backupId: newBackupId,
      // 兩階段審核：員工修改內容 → 退回重跑一審（清掉一審通過狀態與二審留言，由主管重新審）
      firstApprovedAt: null,
      secondReviewMessage: null,
    }
  });

  await logAudit({
    actorId: userId,
    action: "LEAVE_UPDATE",
    targetType: "LeaveRequest",
    targetId: requestId,
    payload: {
      before: {
        leaveTypeId: request.leaveTypeId,
        startDate: request.startDate.toISOString(),
        endDate: request.endDate.toISOString(),
        partOfDay: request.partOfDay,
        durationDays: request.durationDays,
        reason: request.reason,
        backupId: request.backupId,
      },
      after: {
        leaveTypeId: data.leaveTypeId,
        startDate: data.startDate,
        endDate: data.endDate,
        partOfDay: data.partOfDay,
        durationDays: newDuration,
        reason: data.reason ?? null,
        backupId: newBackupId,
      },
    },
  })

  // --- 通知主管：員工修改了待審內容 ---
  const applicantName = displayName(request.user?.name, request.user?.chineseName)
  const newLeaveType = data.leaveTypeId === request.leaveTypeId
    ? request.leaveType
    : await prisma.leaveType.findUnique({ where: { id: data.leaveTypeId } });
  const newLeaveTypeName = newLeaveType?.name || "該假別"
  const before = `${request.leaveType.name}（${formatRange(request.startDate, request.endDate)}，${request.durationDays} 天）`
  const after = `${newLeaveTypeName}（${formatRange(start, end)}，${newDuration} 天）`
  const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:8080"
  const reviewLink = `${siteUrl}/admin/approvals`

  if (request.approverId) {
    const manager = await prisma.user.findUnique({
      where: { id: request.approverId },
      select: { email: true, lineUserId: true, lineNotifyPrefs: true },
    });
    if (manager?.email) {
      await sendLeaveUpdatedEmail(manager.email, applicantName, start, end, data.partOfDay, newDuration, before, after, reviewLink)
    }
    if (shouldSendLine(manager, "leaveUpdated")) {
      await sendLineLeaveUpdated(manager!.lineUserId!, applicantName, before, after, reviewLink)
    }
  }

  // --- 代理人變化通知 ---
  if (request.backupId !== newBackupId) {
    // 舊代理人 → 解除（用舊假單資料）
    if (request.backupId) {
      await notifyBackupRemoved(request.backupId, applicantName, request.leaveType.name, request.startDate, request.endDate, request.partOfDay, request.durationDays, "REMOVED_BY_EDIT")
    }
    // 新代理人 → 指派（用新假單資料）
    if (newBackupId) {
      await notifyBackupAssigned(newBackupId, applicantName, newLeaveTypeName, start, end, data.partOfDay, newDuration, "PENDING")
    }
  }

  revalidatePath("/dashboard")
  revalidatePath("/admin/approvals")
  return { success: true }
}

// 簡單的日期區間顯示（給通知用，Asia/Taipei）
function formatRange(start: Date, end: Date): string {
  const toTW = (d: Date) => {
    const tw = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }))
    return `${tw.getMonth() + 1}/${tw.getDate()}`
  }
  const s = toTW(start)
  const e = toTW(end)
  return s === e ? s : `${s}–${e}`
}

// 對外的 reviewLeave：從 session 拿 actorId 後委派 reviewLeaveAsUser
// 給 web UI 使用；LINE webhook 改走 reviewLeaveAsUser 直接傳入 actorId
export async function reviewLeave(requestId: string, status: "APPROVED" | "REJECTED", message?: string) {
  await assertNotImpersonating()
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return reviewLeaveAsUser(session.user.id, requestId, status, message);
}

// 同一審核邏輯但 actorId 由呼叫端決定（例如 LINE webhook 用綁定的 lineUserId 反查出 User.id）
export async function reviewLeaveAsUser(
  actorId: string,
  requestId: string,
  status: "APPROVED" | "REJECTED",
  message?: string
) {
  // 駁回理由為選填：員工最好知道為什麼被駁、但主管沒寫也允許
  const trimmedMessage = message?.trim() || undefined

  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { user: true, leaveType: true }
  });
  if (!request) throw new Error("Request not found");

  // 由 DB 拿最新的 role/權限，避免外部呼叫端傳入過期 session
  const dbUser = await prisma.user.findUnique({ where: { id: actorId } });
  if (!dbUser || dbUser.terminatedDate) throw new Error("Unauthorized");

  // 只能審核「待審核」狀態的假單，避免對已核准/已駁回/已銷假的單再次審核
  if (request.status !== "PENDING") {
    throw new Error("此假單目前狀態為「" + (
      request.status === "APPROVED" ? "已核准" :
      request.status === "REJECTED" ? "已駁回" :
      request.status === "CANCELLED" ? "已銷假" : request.status
    ) + "」，無法再次審核！");
  }

  // 兩階段審核：用 firstApprovedAt 推導目前階段。
  // firstApprovedAt 為 null → 等一審；非 null → 等二審。secondApproverId 為 null → 此單單階段（一審即最終）。
  const isTwoStage = request.secondApproverId != null
  const inFirstStage = request.firstApprovedAt == null
  const isAdmin = dbUser.role === "ADMIN"

  // 權限：一審 = 指定一審者(approverId) 或 ADMIN；二審 = 指定二審者(secondApproverId) 或 ADMIN（代審）
  const allowed = inFirstStage
    ? (request.approverId === actorId || isAdmin)
    : (request.secondApproverId === actorId || isAdmin)
  if (!allowed) {
    throw new Error("Forbidden");
  }

  // 一審通過但此單仍需二審 → 不是最終核准，僅推進到二審
  const isFirstStagePass = status === "APPROVED" && inFirstStage && isTwoStage
  // 最終核准：單階段的一審核准、或兩階段的二審核准
  const isFinalApprove = status === "APPROVED" && !isFirstStagePass

  // 用 transaction 確保「讀取額度 → 檢查可用 → 更新狀態」是原子操作，
  // updateMany 的 where 帶階段條件（firstApprovedAt），若已被別人改掉會回 count=0 並中止。
  await prisma.$transaction(async (tx) => {
    if (status === "REJECTED") {
      // 任何階段駁回 → 直接 REJECTED 結束（一審寫 reviewMessage、二審寫 secondReviewMessage）
      const result = await tx.leaveRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: inFirstStage
          ? { status: "REJECTED", reviewMessage: trimmedMessage ?? null }
          : { status: "REJECTED", secondReviewMessage: trimmedMessage ?? null },
      });
      if (result.count === 0) throw new Error("此假單已被其他人處理過，請重新整理頁面！");
      return
    }

    if (isFirstStagePass) {
      // 一審通過（兩階段）：硬擋用「一審算式」total - used - pendingSecond，
      // 把已過一審、等二審的其他單也預留掉，先擋掉未來二審必然不足的單。
      const balance = await getUserLeaveBalance(request.userId, request.leaveTypeId, request.startDate);
      const available = balance.total - balance.used - balance.pendingSecond;
      if (request.durationDays > available) {
        throw new Error(`${request.leaveType.name}不足！一審可核准天數為 ${available} 天（您正嘗試核准 ${request.durationDays} 天）。`);
      }
      const result = await tx.leaveRequest.updateMany({
        where: { id: requestId, status: "PENDING", firstApprovedAt: null },
        data: { firstApprovedAt: new Date(), reviewMessage: trimmedMessage ?? null },
      });
      if (result.count === 0) throw new Error("此假單已被其他人處理過，請重新整理頁面！");
      return
    }

    // 最終核准：硬擋用「二審算式」total - used（不扣 pending，避免把正在核准的自己扣掉）
    const balance = await getUserLeaveBalance(request.userId, request.leaveTypeId, request.startDate);
    const actualAvailable = balance.total - balance.used;
    if (request.durationDays > actualAvailable) {
      throw new Error(`${request.leaveType.name}不足！${request.leaveType.name} 目前可核准天數為 ${actualAvailable} 天（您正嘗試核准 ${request.durationDays} 天）。`);
    }
    const result = await tx.leaveRequest.updateMany({
      where: inFirstStage
        ? { id: requestId, status: "PENDING", firstApprovedAt: null }
        : { id: requestId, status: "PENDING", firstApprovedAt: { not: null } },
      data: inFirstStage
        ? { status: "APPROVED", reviewMessage: trimmedMessage ?? null }
        : { status: "APPROVED", secondReviewMessage: trimmedMessage ?? null },
    });
    if (result.count === 0) throw new Error("此假單已被其他人處理過，請重新整理頁面！");
  });

  await logAudit({
    actorId,
    action: status === "REJECTED" ? "LEAVE_REJECT"
      : isFirstStagePass ? "LEAVE_APPROVE_L1"
      : isTwoStage ? "LEAVE_APPROVE_L2" : "LEAVE_APPROVE",
    targetType: "LeaveRequest",
    targetId: requestId,
    payload: { stage: inFirstStage ? 1 : 2, ...(trimmedMessage ? { message: trimmedMessage } : {}) },
  })

  const applicantName = displayName(request.user?.name, request.user?.chineseName)
  const leaveTypeName = request.leaveType.name
  const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:8080"
  const reviewLink = `${siteUrl}/admin/approvals`

  if (isFirstStagePass) {
    // 一審通過 → 通知終審者（Boss）進二審；並通知申請人「一審通過、等待終審」
    const boss = await prisma.user.findUnique({
      where: { id: request.secondApproverId! },
      select: { email: true, lineUserId: true, lineNotifyPrefs: true },
    })
    const managerName = displayName(dbUser.name, dbUser.chineseName)
    if (boss?.email) {
      await sendBossReviewEmail(boss.email, applicantName, managerName, leaveTypeName, request.startDate, request.endDate, request.partOfDay, request.durationDays, reviewLink)
    }
    if (shouldSendLine(boss, "bossReview")) {
      await sendLineBossReview(boss!.lineUserId!, applicantName, leaveTypeName, request.durationDays, reviewLink, requestId)
    }
    if (request.user?.email) {
      await sendFirstApprovedEmail(request.user.email, applicantName, leaveTypeName, request.startDate, request.endDate, request.partOfDay, request.durationDays)
    }
    if (shouldSendLine(request.user, "firstApproved")) {
      await sendLineFirstApproved(request.user.lineUserId!, leaveTypeName)
    }
  } else {
    // 最終結果（核准或駁回）→ 通知申請人本人：Email + LINE 雙軌
    if (request.user?.email) {
      await sendLeaveResultEmail(
        request.user.email,
        applicantName,
        leaveTypeName,
        request.startDate,
        request.endDate,
        request.partOfDay,
        request.durationDays,
        status,
        trimmedMessage,
      );
    }
    if (shouldSendLine(request.user, "reviewResult")) {
      await sendLineLeaveResult(request.user.lineUserId!, leaveTypeName, status, trimmedMessage)
    }

    if (isFinalApprove) {
      // 最終核准 → 通知同部門 + 代理人「已核准」
      await sendApprovedNotifications({
        applicantUserId: request.userId,
        applicantName,
        departmentId: request.user.departmentId,
        leaveTypeName,
        start: request.startDate,
        end: request.endDate,
        partOfDay: request.partOfDay,
        durationDays: request.durationDays,
        backupId: request.backupId,
      })
    } else if (request.backupId) {
      // 駁回 → 解除代理
      await notifyBackupRemoved(request.backupId, applicantName, leaveTypeName, request.startDate, request.endDate, request.partOfDay, request.durationDays, "REJECTED")
    }
  }

  revalidatePath("/admin/approvals")
  revalidatePath("/dashboard")
  revalidatePath("/gantt")
  // outcome：FIRST_APPROVED = 一審通過待二審；APPROVED = 最終核准；REJECTED = 駁回
  const outcome = status === "REJECTED" ? "REJECTED" : isFirstStagePass ? "FIRST_APPROVED" : "APPROVED"
  return { success: true, outcome }
}

// 批次審核：對每張單獨立呼叫 reviewLeave，失敗（如已被別人改、額度不足）獨立回報但不中止整批
export async function batchReviewLeave(ids: string[], status: "APPROVED" | "REJECTED", message?: string) {
  await assertNotImpersonating()
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const successes: string[] = []
  const failures: { id: string; error: string }[] = []

  for (const id of ids) {
    try {
      await reviewLeave(id, status, message)
      successes.push(id)
    } catch (err: any) {
      failures.push({ id, error: err.message || "未知錯誤" })
    }
  }

  return { successes, failures }
}
