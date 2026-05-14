"use server"

import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { calculateDurationDays, getUserLeaveBalance } from "@/lib/leave-utils"
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
  if (!session?.user?.id) throw new Error("Unauthorized");

  const userId = session.user.id;
  const start = new Date(data.startDate);
  const end = new Date(data.endDate);

  if (start > end) throw new Error("Start date cannot be after end date");

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
    throw new Error("此時間區間您已經有申請過假單（待審核或已核准），請勿重複申請！");
  }

  const durationDays = await calculateDurationDays(start, end, data.partOfDay);
  if (durationDays === 0) throw new Error("Duration cannot be 0 days (e.g., trying to take leave only on a weekend/holiday)");

  const year = start.getFullYear();
  const balance = await getUserLeaveBalance(userId, data.leaveTypeId, year);

  if (durationDays > balance.remaining) {
    throw new Error(`Insufficient leave balance. You are trying to take ${durationDays} days, but only have ${balance.remaining} days remaining.`);
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

  const isAdmin = (session.user as any).role === "ADMIN";
  if (request.userId !== session.user.id && !isAdmin) {
    throw new Error("Forbidden");
  }

  if (request.status !== "PENDING") {
    throw new Error("只能撤銷「待審核」狀態的假單！");
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

  if (status === "APPROVED") {
    const year = request.startDate.getFullYear();
    const balance = await getUserLeaveBalance(request.userId, request.leaveTypeId, year);
    if (request.durationDays > balance.remaining) {
      throw new Error(`剩餘假別不夠！您申請了 ${request.durationDays} 天${request.leaveType.name}，但僅剩餘 ${balance.remaining} 天，請確認再請假。`);
    }
  }

  await prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status }
  });

  if (request.user?.email) {
    await sendLeaveResultEmail(request.user.email, request.leaveType.name, status);
  }

  revalidatePath("/admin/approvals")
  revalidatePath("/dashboard")
  revalidatePath("/admin/gantt")
  return { success: true }
}
