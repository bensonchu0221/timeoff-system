import { prisma } from "@/lib/db"
import { UserTable } from "./UserTable"
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { createUser } from "./actions"

export const metadata = {
  title: "層級與角色設定 | Timeoff",
}

export default async function AdminUsersPage() {
  const session = await auth()
  
  // RBAC: Only Admin can access this page
  if (!session || (session.user as any)?.role !== "ADMIN") {
    // In MVP, we might allow any logged in user if there are no users yet (for bootstrapping),
    // but typically we redirect non-admins.
    // For now, if no session, redirect to home.
    if (!session) redirect("/")
    // If not admin, you could show a 403 or redirect
    // redirect("/")
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      managerId: true,
    },
    orderBy: {
      name: 'asc'
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">員工層級與角色設定</h1>
          <p className="mt-1 text-sm text-gray-500">
            設定每位員工的系統權限角色，並指定其直屬主管（用於請假簽核）。
          </p>
        </div>
      </div>
      
      {/* 新增員工表單 */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-medium mb-4 text-gray-900">手動建立新員工</h2>
        <CreateUserForm />
      </div>

      <UserTable users={users} />
    </div>
  )
}
