"use server"

import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { calculateDurationDays, getUserLeaveBalance } from "@/lib/leave-utils"
import { todayStartUTCFromTaipei } from "@/lib/date-format"
import { PartOfDay, LeaveStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { sendLeaveApplicationEmail, sendLeaveResultEmail } from "@/lib/email"

export async function applyLeave(data: {
  leaveTypeId: string,
  startDate: string,
  endDate: string,
  partOfDay: PartOfDay,
  reason?: string
}) {
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

  const year = start.getFullYear();
  const balance = await getUserLeaveBalance(userId, data.leaveTypeId, year);

  if (durationDays > balance.remaining) {
    return { error: `假數不足！您嘗試申請 ${durationDays} 天，但僅剩餘 ${balance.remaining} 天（包含審核中假單）。` };
  }

  // Get user's manager to assign approver
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const approverId = user?.managerId;

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
      approverId
    }
  });

  if (approverId) {
    const manager = await prisma.user.findUnique({ where: { id: approverId } });
    if (manager?.email) {
      const leaveTypeObj = await prisma.leaveType.findUnique({ where: { id: data.leaveTypeId } });
      const siteUrl = process.env.NEXTAUTH_URL || "http://localhost:8080";
      await sendLeaveApplicationEmail(
        manager.email,
        user?.name || "員工",
        leaveTypeObj?.name || "假別",
        durationDays,
        `${siteUrl}/admin/approvals`
      );
    }
  }

  revalidatePath("/dashboard")
  return { success: true, request: leaveRequest }
}

export async function cancelLeave(requestId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const request = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
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

  await prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" }
  });

  revalidatePath("/dashboard")
  revalidatePath("/admin/approvals")
  return { success: true }
}

export async function reviewLeave(requestId: string, status: "APPROVED" | "REJECTED") {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { user: true, leaveType: true }
  });
  if (!request) throw new Error("Request not found");

  // Fetch user from DB to ensure we have the latest role/permissions
  const dbUser = await prisma.user.findUnique({ where: { id: session.user.id } });
  
  const isAssignedManager = request.approverId === session.user.id;
  const hasPrivilegedRole = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER";

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

  // 用 transaction 確保「讀取餘額 → 檢查額度 → 更新狀態」是原子操作，
  // 避免兩位主管同時審核兩張單時各自讀到舊餘額，雙雙通過導致超支。
  // updateMany 加上 status: PENDING 的條件，若已被別人改掉會回 count=0 並中止。
  await prisma.$transaction(async (tx) => {
    if (status === "APPROVED") {
      const year = request.startDate.getFullYear();
      const balance = await getUserLeaveBalance(request.userId, request.leaveTypeId, year);
      const actualAvailable = balance.total - balance.used;
      if (request.durationDays > actualAvailable) {
        throw new Error(`剩餘假別不夠！該假別目前剩餘可核准天數為 ${actualAvailable} 天（您正嘗試核准 ${request.durationDays} 天）。`);
      }
    }

    const result = await tx.leaveRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status }
    });
    if (result.count === 0) {
      throw new Error("此假單已被其他人處理過，請重新整理頁面！");
    }
  });

  if (request.user?.email) {
    await sendLeaveResultEmail(request.user.email, request.leaveType.name, status);
  }

  revalidatePath("/admin/approvals")
  revalidatePath("/dashboard")
  revalidatePath("/admin/gantt")
  return { success: true }
}
