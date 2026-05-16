"use client"

import { Role } from "@prisma/client"
import { useTransition } from "react"
import { updateUserRole, updateUserManager, updateUserHireDate, updateUserGender, updateUserTerminatedDate } from "./actions"
import toast from "react-hot-toast"

type UserNode = {
  id: string
  name: string | null
  email: string
  role: Role
  managerId: string | null
  hireDate: Date | null
  gender: string
  terminatedDate: Date | null
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

  const handleTerminatedDateChange = (userId: string, dateStr: string) => {
    startTransition(async () => {
      try {
        const res = await updateUserTerminatedDate(userId, dateStr)
        if (res?.success) toast.success(res.message)
      } catch (err: any) {
        toast.error(err.message || "更新失敗")
      }
    })
  }

  // 可選主管：限定在職的 MANAGER / ADMIN，已離職的不能再被選為主管
  const managers = users.filter(u => (u.role === "MANAGER" || u.role === "ADMIN") && !u.terminatedDate)

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto border border-gray-200">
      <table className="min-w-max w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">員工</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">角色權限</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">性別</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">直屬主管</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">到職日</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">離職日</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {users.map((user) => {
            const isTerminated = !!user.terminatedDate
            return (
            <tr key={user.id} className={isTerminated ? "bg-gray-50 opacity-60" : ""}>
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex flex-col">
                  <span className="font-medium text-gray-900 flex items-center gap-2">
                    {user.name || "未設定名稱"}
                    {isTerminated && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-gray-200 text-gray-600 font-normal">已離職</span>
                    )}
                  </span>
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
                <div className="join">
                  <input
                    type="radio"
                    name={`gender-${user.id}`}
                    value="MALE"
                    aria-label="男"
                    checked={user.gender === "MALE"}
                    onChange={() => handleGenderChange(user.id, "MALE")}
                    disabled={isPending}
                    className="join-item btn btn-sm checked:bg-gray-300 checked:text-gray-800 checked:border-gray-400 hover:checked:bg-gray-400"
                  />
                  <input
                    type="radio"
                    name={`gender-${user.id}`}
                    value="FEMALE"
                    aria-label="女"
                    checked={user.gender === "FEMALE"}
                    onChange={() => handleGenderChange(user.id, "FEMALE")}
                    disabled={isPending}
                    className="join-item btn btn-sm checked:bg-gray-300 checked:text-gray-800 checked:border-gray-400 hover:checked:bg-gray-400"
                  />
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
              <td className="px-6 py-4 whitespace-nowrap">
                <input
                  type="date"
                  disabled={isPending}
                  value={user.terminatedDate ? user.terminatedDate.toISOString().split('T')[0] : ''}
                  onChange={(e) => handleTerminatedDateChange(user.id, e.target.value)}
                  className="input input-bordered input-sm w-full bg-gray-50"
                  title="標記離職日；清空可恢復為在職"
                />
              </td>
            </tr>
          )})}
        </tbody>
      </table>
    </div>
  )
}
