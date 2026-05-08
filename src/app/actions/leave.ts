"use server"

import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { calculateDurationDays, getUserLeaveBalance } from "@/lib/leave-utils"
import { PartOfDay, LeaveStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"

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

  // TODO: Send Gmail notification to approver if approverId exists (Phase 6)

  revalidatePath("/dashboard")
  return { success: true, request: leaveRequest }
}

export async function cancelLeave(requestId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const request = await prisma.leaveRequest.findUnique({ where: { id: requestId }});
  if (!request) throw new Error("Request not found");

  // User can only cancel their own leaves or Admin can cancel any
  const isAdmin = (session.user as any).role === "ADMIN";
  if (request.userId !== session.user.id && !isAdmin) {
    throw new Error("Forbidden");
  }

  // If approved, maybe it requires manager approval to cancel? We'll just cancel it for now (MVP rule: "若假單已核准，員工仍可申請撤回，但需經過主管同意（或自動退回假數）" -> Let's implement auto-return for MVP to keep it simple).
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

  const request = await prisma.leaveRequest.findUnique({ where: { id: requestId }});
  if (!request) throw new Error("Request not found");

  const isManager = request.approverId === session.user.id;
  const isAdmin = (session.user as any).role === "ADMIN";

  if (!isManager && !isAdmin) {
    throw new Error("Forbidden");
  }

  await prisma.leaveRequest.update({
    where: { id: requestId },
    data: { status }
  });

  // TODO: Send Gmail notification to applicant (Phase 6)

  revalidatePath("/admin/approvals")
  revalidatePath("/dashboard")
  return { success: true }
}
