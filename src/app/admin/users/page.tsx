import { prisma } from "@/lib/db"
import { UserTable } from "./UserTable"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { CreateUserForm } from "./CreateUserForm"
import { getUserLeaveBalance } from "@/lib/leave-utils"
import { todayStartUTCFromTaipei } from "@/lib/date-format"

export const metadata = {
  title: "層級與角色設定 | Timeoff",
}

export default async function AdminUsersPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/")
  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (me?.role !== "ADMIN") redirect("/")

  // admin 頁面同時顯示在職與離職者（離職者會被前端打灰並標籤），方便 HR 還能進行設定/復職
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      chineseName: true,
      email: true,
      role: true,
      departmentId: true,
      department: { select: { id: true, name: true } },
      company: true,
      managerId: true,
      isFinalApprover: true,
      hireDate: true,
      gender: true,
      terminatedDate: true,
      annualLeaveOpeningBalance: true,
      annualLeaveOpeningAt: true,
      annualLeaveOpeningB: true,
      annualLeaveOpeningR: true,
    },
    orderBy: [
      { terminatedDate: 'asc' }, // 在職在上（null 排前）
      { name: 'asc' }
    ]
  })

  // 每位在職員工目前的特休剩餘（讀發放紀錄）
  const annualType = await prisma.leaveType.findFirst({ where: { isActive: true, name: { contains: "特休" } }, select: { id: true } })
  const remainingByUser: Record<string, number> = {}
  if (annualType) {
    for (const u of users) {
      if (u.terminatedDate) continue
      remainingByUser[u.id] = (await getUserLeaveBalance(u.id, annualType.id)).remaining
    }
  }
  const nextYear = todayStartUTCFromTaipei().getUTCFullYear() + 1

  // 下拉選項只取啟用中的部門；新增 user 與 inline 改部門共用
  const departments = await prisma.department.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">員工層級與角色設定</h1>
        <p className="mt-1 text-sm text-gray-500">
          設定每位員工的系統權限角色，並指定其直屬主管（用於請假簽核）。
        </p>
      </div>

      {/* 新增員工表單 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-medium mb-4 text-gray-900">手動建立新員工</h2>
        <CreateUserForm departments={departments} />
      </div>

      <UserTable users={users} departments={departments} remainingByUser={remainingByUser} nextYear={nextYear} />
    </div>
  )
}
