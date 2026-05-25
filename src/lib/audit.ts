import { prisma } from "./db"

// 所有寫操作的稽核分類；新增動作時請同步更新此列表
export type AuditAction =
  | "LEAVE_APPLY"
  | "LEAVE_AUTO_APPROVE"
  | "LEAVE_APPROVE"
  | "LEAVE_APPROVE_L1"
  | "LEAVE_APPROVE_L2"
  | "LEAVE_REJECT"
  | "LEAVE_CANCEL"
  | "LEAVE_UPDATE"
  | "USER_CREATE"
  | "USER_UPDATE_ROLE"
  | "USER_UPDATE_MANAGER"
  | "USER_SET_FINAL_APPROVER"
  | "USER_UPDATE_HIREDATE"
  | "USER_UPDATE_GENDER"
  | "USER_UPDATE_CHINESE_NAME"
  | "USER_UPDATE_DEPARTMENT"
  | "USER_SET_ANNUAL_OPENING"
  | "USER_CLEAR_ANNUAL_OPENING"
  | "USER_TERMINATE"
  | "USER_REACTIVATE"
  | "USER_RESET_CALENDAR_TOKEN"
  | "BALANCE_UPDATE"
  | "LEAVE_TYPE_CREATE"
  | "LEAVE_TYPE_UPDATE"
  | "LEAVE_TYPE_DELETE"
  | "HOLIDAY_SYNC"
  | "USER_ADD_LEAVE_ADJUSTMENT"
  | "USER_DELETE_LEAVE_ADJUSTMENT"
  | "DEPARTMENT_CREATE"
  | "DEPARTMENT_UPDATE_NAME"
  | "DEPARTMENT_UPDATE_CODE"
  | "DEPARTMENT_UPDATE_SORT"
  | "DEPARTMENT_TOGGLE_ACTIVE"

export type AuditTargetType = "LeaveRequest" | "User" | "LeaveType" | "UserLeaveBalance" | "Holiday" | "LeaveAdjustment" | "Department"

// 寫一筆稽核紀錄；audit 失敗不應該擋住主流程，因此 try/catch 後僅 console.error
export async function logAudit(params: {
  actorId: string
  action: AuditAction
  targetType: AuditTargetType
  targetId: string
  payload?: Record<string, unknown>
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        payload: params.payload as any,
      },
    })
  } catch (err) {
    console.error("logAudit failed:", err, params)
  }
}
