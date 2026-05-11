"use client"

import { Role } from "@prisma/client"
import { useTransition } from "react"
import { updateUserRole, updateUserManager } from "./actions"
import toast from "react-hot-toast"

type UserNode = {
  id: string
  name: string | null
  email: string
  role: Role
  managerId: string | null
}

export function UserTable({ users }: { users: UserNode[] }) {
  const [isPending, startTransition] = useTransition()

  const handleRoleChange = (userId: string, newRole: Role) => {
    startTransition(async () => {
      try {
        const res = await updateUserRole(userId, newRole)
        if (res?.success) toast.success(res.message)
      } catch (err: any) {
        toast.error(err.message || "更新失敗")
      }
    })
  }

  const handleManagerChange = (userId: string, managerId: string) => {
    startTransition(async () => {
      try {
        const res = await updateUserManager(userId, managerId === "none" ? null : managerId)
        if (res?.success) toast.success(res.message)
      } catch (err: any) {
        toast.error(err.message || "更新失敗")
      }
    })
  }

  // Potential managers (anyone who is MANAGER or ADMIN)
  const managers = users.filter(u => u.role === "MANAGER" || u.role === "ADMIN")

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">員工</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">角色權限</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">直屬主管</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {users.map((user) => (
            <tr key={user.id}>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex flex-col">
                  <span className="font-medium text-gray-900">{user.name || "未設定名稱"}</span>
                  <span className="text-gray-500">{user.email}</span>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <select
                  disabled={isPending}
                  value={user.role}
                  onChange={(e) => handleRoleChange(user.id, e.target.value as Role)}
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-[var(--brand-primary)] focus:border-[var(--brand-primary)] sm:text-sm rounded-md bg-gray-50"
                >
                  <option value="EMPLOYEE">員工 (Employee)</option>
                  <option value="MANAGER">主管 (Manager)</option>
                  <option value="ADMIN">管理員 (Admin)</option>
                </select>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <select
                  disabled={isPending}
                  value={user.managerId || "none"}
                  onChange={(e) => handleManagerChange(user.id, e.target.value)}
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-[var(--brand-primary)] focus:border-[var(--brand-primary)] sm:text-sm rounded-md bg-gray-50"
                >
                  <option value="none">無直屬主管</option>
                  {managers
                    .filter((m) => m.id !== user.id) // 避免設定自己為主管
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.email}
                      </option>
                    ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
