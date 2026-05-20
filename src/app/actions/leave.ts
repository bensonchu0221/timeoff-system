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
} from "@/lib/line"
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

  // 先 fetch user：特休 3 個月 gate 與 manager 都要用
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const approverId = user?.managerId;

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

  const leaveRequest = await prisma.leaveRequest.create({
    data: {
      userId,
      leaveTypeId: data.leaveTypeId,
      startDate: start,
      endDate: end,
      partOfDay: data.partOfDay,
      reason: data.reason,
      durationDays,
      status: "PENDING",
      approverId,
      backupId,
    }
  });

  await logAudit({
    actorId: userId,
    action: "LEAVE_APPLY",
    targetType: "LeaveRequest",
    targetId: leaveRequest.id,
    payload: {
      leaveTypeId: data.leaveTypeId,
      startDate: data.startDate,
      endDate: data.endDate,
      durationDays,
    },
  })

  if (approverId) {
    const manager = await prisma.user.findUnique({ where: { id: approverId } });
    const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:8080";
    const reviewLink = `${siteUrl}/admin/approvals`;
    const applicantName = user?.name || "員工";

    if (manager?.email) {
      await sendLeaveApplicationEmail(
        manager.email,
        applicantName,
        leaveTypeName,
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
    await notifyBackupAssigned(backupId, user?.name || "同事", leaveTypeName, start, end, "PENDING")
  }

  revalidatePath("/dashboard")
  return { success: true, request: leaveRequest }
}

// ----- 通知 helpers（在 actions 內共用，呼叫 email + LINE）-----

async function notifyBackupAssigned(
  backupUserId: string,
  applicantName: string,
  leaveType: string,
  start: Date,
  end: Date,
  status: "PENDING" | "APPROVED"
) {
  const backup = await prisma.user.findUnique({
    where: { id: backupUserId },
    select: { email: true, lineUserId: true, lineNotifyPrefs: true },
  })
  if (!backup) return
  if (backup.email) {
    await sendBackupAssignedEmail(backup.email, applicantName, leaveType, start, end, status)
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
  reason: "REMOVED_BY_EDIT" | "CANCELLED" | "REJECTED"
) {
  const backup = await prisma.user.findUnique({
    where: { id: backupUserId },
    select: { email: true, lineUserId: true, lineNotifyPrefs: true },
  })
  if (!backup) return
  if (backup.email) {
    await sendBackupRemovedEmail(backup.email, applicantName, leaveType, start, end, reason)
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
  const applicantName = request.user?.name || "員工"
  const leaveTypeName = request.leaveType.name
  const start = request.startDate
  const end = request.endDate

  // 通知原審核主管（不管原狀態，都讓他知道）
  if (request.approverId) {
    const manager = await prisma.user.findUnique({
      where: { id: request.approverId },
      select: { email: true, lineUserId: true, lineNotifyPrefs: true },
    });
    if (manager?.email) {
      await sendLeaveCancelledEmail(manager.email, applicantName, leaveTypeName, start, end, previousStatus)
    }
    if (shouldSendLine(manager, "leaveCancelled")) {
      await sendLineLeaveCancelled(manager!.lineUserId!, applicantName, leaveTypeName, start, end, previousStatus)
    }
  }

  // 已核准 → 同部門也要通知（原本同部門已通知會請假，現在撤銷了）
  if (previousStatus === "APPROVED" && request.user.department) {
    const teammates = await prisma.user.findMany({
      where: {
        department: request.user.department,
        terminatedDate: null,
        id: { not: request.userId },
      },
      select: { email: true, lineUserId: true, lineNotifyPrefs: true },
    })
    await Promise.allSettled(teammates.flatMap(t => {
      const tasks: Promise<unknown>[] = []
      if (t.email) tasks.push(sendLeaveCancelledEmail(t.email, applicantName, leaveTypeName, start, end, previousStatus))
      if (shouldSendLine(t, "leaveCancelled")) tasks.push(sendLineLeaveCancelled(t.lineUserId!, applicantName, leaveTypeName, start, end, previousStatus))
      return tasks
    }))
  }

  // 通知代理人「不用代理了」
  if (request.backupId) {
    await notifyBackupRemoved(request.backupId, applicantName, leaveTypeName, start, end, "CANCELLED")
  }

  revalidatePath("/dashboard")
  revalidatePath("/admin/approvals")
  revalidatePath("/admin/gantt")
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
  const applicantName = request.user?.name || "員工"
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
      await sendLeaveUpdatedEmail(manager.email, applicantName, before, after, reviewLink)
    }
    if (shouldSendLine(manager, "leaveUpdated")) {
      await sendLineLeaveUpdated(manager!.lineUserId!, applicantName, before, after, reviewLink)
    }
  }

  // --- 代理人變化通知 ---
  if (request.backupId !== newBackupId) {
    // 舊代理人 → 解除
    if (request.backupId) {
      await notifyBackupRemoved(request.backupId, applicantName, request.leaveType.name, request.startDate, request.endDate, "REMOVED_BY_EDIT")
    }
    // 新代理人 → 指派
    if (newBackupId) {
      await notifyBackupAssigned(newBackupId, applicantName, newLeaveTypeName, start, end, "PENDING")
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

  const isAssignedManager = request.approverId === actorId;
  const hasPrivilegedRole = dbUser.role === "ADMIN" || dbUser.role === "MANAGER";

  if (!isAssignedManager && !hasPrivilegedRole) {
    throw new Error("Forbidden");
  }

  // 只能審核「待審核」狀態的假單，避免對已核准/已駁回/已銷假的單再次審核
  if (request.status !== "PENDING") {
    throw new Error("此假單目前狀態為「" + (
      request.status === "APPROVED" ? "已核准" :
      request.status === "REJECTED" ? "已駁回" :
      request.status === "CANCELLED" ? "已銷假" : request.status
    ) + "」，無法再次審核！");
  }

  // 用 transaction 確保「讀取額度 → 檢查可用 → 更新狀態」是原子操作，
  // 避免兩位主管同時審核兩張單時各自讀到舊資料，雙雙通過導致超支。
  // updateMany 加上 status: PENDING 的條件，若已被別人改掉會回 count=0 並中止。
  await prisma.$transaction(async (tx) => {
    if (status === "APPROVED") {
      const balance = await getUserLeaveBalance(request.userId, request.leaveTypeId, request.startDate);
      const actualAvailable = balance.total - balance.used;
      if (request.durationDays > actualAvailable) {
        throw new Error(`${request.leaveType.name}不足！${request.leaveType.name} 目前可核准天數為 ${actualAvailable} 天（您正嘗試核准 ${request.durationDays} 天）。`);
      }
    }

    const result = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status, reviewMessage: trimmedMessage ?? null }
    });
    if (result.count === 0) {
      throw new Error("此假單已被其他人處理過，請重新整理頁面！");
    }
  });

  await logAudit({
    actorId,
    action: status === "APPROVED" ? "LEAVE_APPROVE" : "LEAVE_REJECT",
    targetType: "LeaveRequest",
    targetId: requestId,
    payload: trimmedMessage ? { message: trimmedMessage } : undefined,
  })

  // 通知申請人本人：Email + LINE 雙軌
  if (request.user?.email) {
    await sendLeaveResultEmail(request.user.email, request.leaveType.name, status, trimmedMessage);
  }
  if (shouldSendLine(request.user, "reviewResult")) {
    await sendLineLeaveResult(
      request.user.lineUserId!,
      request.leaveType.name,
      status,
      trimmedMessage
    );
  }

  // 同部門通知：只在「核准」後送，提醒同部門同事誰會請假
  if (status === "APPROVED" && request.user.department) {
    const teammates = await prisma.user.findMany({
      where: {
        department: request.user.department,
        terminatedDate: null,
        id: { not: request.userId },
      },
      select: {
        id: true,
        name: true,
        email: true,
        lineUserId: true,
        lineNotifyPrefs: true,
      },
    });

    const applicantName = request.user.name || "同事"
    const leaveTypeName = request.leaveType.name
    const start = request.startDate
    const end = request.endDate

    // 並行送、單一失敗不擋其他人，也不擋主流程
    await Promise.allSettled(
      teammates.flatMap((t) => {
        const tasks: Promise<unknown>[] = []
        if (t.email) {
          tasks.push(sendDepartmentLeaveEmail(t.email, applicantName, leaveTypeName, start, end))
        }
        if (shouldSendLine(t, "departmentLeave")) {
          tasks.push(sendLineSameDepartment(t.lineUserId!, applicantName, leaveTypeName, start, end))
        }
        return tasks
      })
    )
  }

  // 代理人通知：核准後正式生效；駁回則解除代理
  if (request.backupId) {
    const applicantNameFull = request.user?.name || "員工"
    if (status === "APPROVED") {
      await notifyBackupAssigned(request.backupId, applicantNameFull, request.leaveType.name, request.startDate, request.endDate, "APPROVED")
    } else {
      await notifyBackupRemoved(request.backupId, applicantNameFull, request.leaveType.name, request.startDate, request.endDate, "REJECTED")
    }
  }

  revalidatePath("/admin/approvals")
  revalidatePath("/dashboard")
  revalidatePath("/admin/gantt")
  return { success: true }
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
