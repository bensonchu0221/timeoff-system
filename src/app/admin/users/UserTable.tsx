"use client"

import { Role } from "@prisma/client"
import { useTransition } from "react"
import { updateUserRole, updateUserManager, updateUserHireDate, updateUserGender } from "./actions"
import toast from "react-hot-toast"

type UserNode = {
  id: string
  name: string | null
  email: string
  role: Role
  managerId: string | null
  hireDate: Date | null
  gender: string
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

  const handleHireDateChange = (userId: string, dateStr: string) => {
    startTransition(async () => {
      try {
        const res = await updateUserHireDate(userId, dateStr)
        if (res?.success) toast.success(res.message)
      } catch (err: any) {
        toast.error(err.message || "更新失敗")
      }
    })
  }

  const handleGenderChange = (userId: string, newGender: string) => {
    startTransition(async () => {
      try {
        const res = await updateUserGender(userId, newGender)
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
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">性別</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">直屬主管</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">到職日</th>
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
                  className="select select-bordered select-sm w-full bg-gray-50"
                >
                  <option value="EMPLOYEE">員工</option>
                  <option value="MANAGER">主管</option>
                  <option value="ADMIN">管理員</option>
                </select>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex gap-4 items-center h-full">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input 
                      type="radio" 
                      name={`gender-${user.id}`} 
                      value="MALE" 
                      checked={user.gender === "MALE"} 
                      onChange={() => handleGenderChange(user.id, "MALE")}
                      className="radio radio-primary radio-sm bg-white" 
                      disabled={isPending}
                    />
                    <span className="text-sm">男</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input 
                      type="radio" 
                      name={`gender-${user.id}`} 
                      value="FEMALE" 
                      checked={user.gender === "FEMALE"} 
                      onChange={() => handleGenderChange(user.id, "FEMALE")}
                      className="radio radio-primary radio-sm bg-white" 
                      disabled={isPending}
                    />
                    <span className="text-sm">女</span>
                  </label>
                </div>
              </td>
              <td className="px-6 py-4 whitespace-nowrap">
                <select
                  disabled={isPending}
                  value={user.managerId || "none"}
                  onChange={(e) => handleManagerChange(user.id, e.target.value)}
                  className="select select-bordered select-sm w-full bg-gray-50"
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
              <td className="px-6 py-4 whitespace-nowrap">
                <input
                  type="date"
                  disabled={isPending}
                  value={user.hireDate ? user.hireDate.toISOString().split('T')[0] : ''}
                  onChange={(e) => handleHireDateChange(user.id, e.target.value)}
                  className="input input-bordered input-sm w-full bg-gray-50"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
