"use client"

import { Role } from "@prisma/client"
import { useState, useTransition } from "react"
import {
  updateUserRole,
  updateUserManager,
  updateUserHireDate,
  updateUserGender,
  updateUserTerminatedDate,
  updateUserChineseName,
  updateUserDepartment,
  setAnnualLeaveOpening,
  clearAnnualLeaveOpening,
} from "./actions"
import toast from "react-hot-toast"

type UserNode = {
  id: string
  name: string | null
  chineseName: string | null
  email: string
  role: Role
  department: string | null
  managerId: string | null
  hireDate: Date | null
  gender: string
  terminatedDate: Date | null
  annualLeaveOpeningBalance: number | null
  annualLeaveOpeningAt: Date | null
}

export function UserTable({ users }: { users: UserNode[] }) {
  const [isPending, startTransition] = useTransition()

  const wrap = (fn: () => Promise<{ success: boolean; message: string } | void>) => {
    startTransition(async () => {
      try {
        const res = await fn()
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
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">中文姓名</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">角色權限</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">性別</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">部門</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">直屬主管</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">到職日</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">特休 Opening</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">離職日</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {users.map((user) => {
            const isTerminated = !!user.terminatedDate
            return (
              <tr key={user.id} className={isTerminated ? "bg-gray-50 opacity-60" : ""}>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-900 flex items-center gap-2">
                      {user.name || "未設定名稱"}
                      {user.chineseName && (
                        <span className="text-xs text-gray-400 font-normal">{user.chineseName}</span>
                      )}
                      {isTerminated && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-gray-200 text-gray-600 font-normal">已離職</span>
                      )}
                    </span>
                    <span className="text-gray-500">{user.email}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <InlineTextCell
                    initial={user.chineseName ?? ""}
                    placeholder="申芳萍"
                    disabled={isPending}
                    onSave={(val) => wrap(() => updateUserChineseName(user.id, val))}
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <select
                    disabled={isPending}
                    value={user.role}
                    onChange={(e) => wrap(() => updateUserRole(user.id, e.target.value as Role))}
                    className="select select-bordered select-sm w-full bg-gray-50"
                  >
                    <option value="EMPLOYEE">員工</option>
                    <option value="MANAGER">主管</option>
                    <option value="ADMIN">管理員</option>
                  </select>
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <div className="join">
                    <input
                      type="radio"
                      name={`gender-${user.id}`}
                      value="MALE"
                      aria-label="男"
                      checked={user.gender === "MALE"}
                      onChange={() => wrap(() => updateUserGender(user.id, "MALE"))}
                      disabled={isPending}
                      className="join-item btn btn-sm checked:bg-gray-300 checked:text-gray-800 checked:border-gray-400 hover:checked:bg-gray-400"
                    />
                    <input
                      type="radio"
                      name={`gender-${user.id}`}
                      value="FEMALE"
                      aria-label="女"
                      checked={user.gender === "FEMALE"}
                      onChange={() => wrap(() => updateUserGender(user.id, "FEMALE"))}
                      disabled={isPending}
                      className="join-item btn btn-sm checked:bg-gray-300 checked:text-gray-800 checked:border-gray-400 hover:checked:bg-gray-400"
                    />
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <InlineTextCell
                    initial={user.department ?? ""}
                    placeholder="tech"
                    disabled={isPending}
                    onSave={(val) => wrap(() => updateUserDepartment(user.id, val))}
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <select
                    disabled={isPending}
                    value={user.managerId || "none"}
                    onChange={(e) => wrap(() => updateUserManager(user.id, e.target.value === "none" ? null : e.target.value))}
                    className="select select-bordered select-sm w-full bg-gray-50"
                  >
                    <option value="none">無直屬主管</option>
                    {managers
                      .filter((m) => m.id !== user.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name || m.email}
                        </option>
                      ))}
                  </select>
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <input
                    type="date"
                    disabled={isPending}
                    value={user.hireDate ? user.hireDate.toISOString().split("T")[0] : ""}
                    onChange={(e) => wrap(() => updateUserHireDate(user.id, e.target.value))}
                    className="input input-bordered input-sm w-full bg-gray-50"
                  />
                </td>
                <td className="px-6 py-4 align-top">
                  <OpeningCell
                    userId={user.id}
                    initialBalance={user.annualLeaveOpeningBalance}
                    initialAt={user.annualLeaveOpeningAt}
                    disabled={isPending}
                    onSave={(b, at) => wrap(() => setAnnualLeaveOpening(user.id, b, at))}
                    onClear={() => wrap(() => clearAnnualLeaveOpening(user.id))}
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <input
                    type="date"
                    disabled={isPending}
                    value={user.terminatedDate ? user.terminatedDate.toISOString().split("T")[0] : ""}
                    onChange={(e) => wrap(() => updateUserTerminatedDate(user.id, e.target.value))}
                    className="input input-bordered input-sm w-full bg-gray-50"
                    title="標記離職日；清空可恢復為在職"
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// 通用 inline text input：onBlur 觸發儲存
function InlineTextCell({
  initial,
  placeholder,
  disabled,
  onSave,
}: {
  initial: string
  placeholder?: string
  disabled?: boolean
  onSave: (val: string) => void
}) {
  const [val, setVal] = useState(initial)
  return (
    <input
      type="text"
      disabled={disabled}
      value={val}
      placeholder={placeholder}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        if (val !== initial) onSave(val)
      }}
      className="input input-bordered input-sm w-32 bg-gray-50"
    />
  )
}

// Opening Balance 設定控件：兩個 input + 儲存 + 清除（已設時才有）
function OpeningCell({
  initialBalance,
  initialAt,
  disabled,
  onSave,
  onClear,
}: {
  userId: string
  initialBalance: number | null
  initialAt: Date | null
  disabled?: boolean
  onSave: (balance: number, atISO: string) => void
  onClear: () => void
}) {
  const initialBalanceStr = initialBalance !== null ? String(initialBalance) : ""
  const initialAtStr = initialAt ? initialAt.toISOString().split("T")[0] : "2026-01-01"
  const [balance, setBalance] = useState(initialBalanceStr)
  const [at, setAt] = useState(initialAtStr)
  const hasOpening = initialBalance !== null

  const handleSave = () => {
    const num = Number(balance)
    if (balance.trim() === "" || isNaN(num)) {
      toast.error("請填天數")
      return
    }
    if (!at) {
      toast.error("請填日期")
      return
    }
    onSave(num, at)
  }

  const handleClear = () => {
    if (!confirm("清除特休 Opening 後，該員工特休改從入職日累計（會大量增加可請天數）。確定？")) return
    setBalance("")
    onClear()
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <input
          type="number"
          step="0.5"
          disabled={disabled}
          value={balance}
          placeholder="天數"
          onChange={(e) => setBalance(e.target.value)}
          className="input input-bordered input-sm w-20 bg-gray-50"
        />
        <span className="text-xs text-gray-400">@</span>
        <input
          type="date"
          disabled={disabled}
          value={at}
          onChange={(e) => setAt(e.target.value)}
          className="input input-bordered input-sm w-36 bg-gray-50"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={disabled}
          className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded hover:bg-blue-200 disabled:opacity-50"
        >
          儲存
        </button>
        {hasOpening && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className="text-[10px] text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            清除
          </button>
        )}
        {!hasOpening && <span className="text-[10px] text-gray-400">未設定（走入職日累計）</span>}
      </div>
    </div>
  )
}
