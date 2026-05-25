"use client"

import { useState, useTransition } from "react"
import toast from "react-hot-toast"
import {
  updateDepartmentName,
  updateDepartmentCode,
  updateDepartmentSortOrder,
  toggleDepartmentActive,
} from "./actions"

export type DepartmentRow = {
  id: string
  name: string
  code: string | null
  sortOrder: number
  isActive: boolean
  userCount: number
}

export function DepartmentTable({ rows }: { rows: DepartmentRow[] }) {
  const [isPending, startTransition] = useTransition()

  const wrap = (fn: () => Promise<{ success: boolean; message: string } | void>) => {
    startTransition(async () => {
      try {
        const res = await fn()
        if (res) {
          if (res.success) {
            toast.success(res.message)
          } else {
            toast.error(res.message)
          }
        }
      } catch (err: any) {
        toast.error(err.message || "更新失敗")
      }
    })
  }

  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 text-sm bg-gray-50 rounded-md">
        尚無部門，請從上方新增。
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-500">部門名稱</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">代碼</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">排序</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">人數</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">啟用</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.id} className={row.isActive ? "" : "bg-gray-50 opacity-60"}>
              <td className="px-4 py-3">
                <InlineTextCell
                  initial={row.name}
                  placeholder="部門名稱"
                  disabled={isPending}
                  onSave={(val) => wrap(() => updateDepartmentName(row.id, val))}
                />
              </td>
              <td className="px-4 py-3">
                <InlineTextCell
                  initial={row.code ?? ""}
                  placeholder="(無代碼)"
                  disabled={isPending}
                  onSave={(val) => wrap(() => updateDepartmentCode(row.id, val))}
                />
              </td>
              <td className="px-4 py-3">
                <InlineNumberCell
                  initial={row.sortOrder}
                  disabled={isPending}
                  onSave={(val) => wrap(() => updateDepartmentSortOrder(row.id, val))}
                />
              </td>
              <td className="px-4 py-3 text-gray-600">{row.userCount}</td>
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={row.isActive}
                  disabled={isPending}
                  onChange={(e) => wrap(() => toggleDepartmentActive(row.id, e.target.checked))}
                  className="toggle toggle-sm"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-gray-500">
        備註：停用前該部門必須無使用者，否則會被擋下。停用後新建表單下拉不再顯示，但既有 user 仍保留掛在此部門。
      </p>
    </div>
  )
}

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

function InlineNumberCell({
  initial,
  disabled,
  onSave,
}: {
  initial: number
  disabled?: boolean
  onSave: (val: number) => void
}) {
  const [val, setVal] = useState(String(initial))
  return (
    <input
      type="number"
      disabled={disabled}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        const num = Number(val)
        if (!isNaN(num) && num !== initial) onSave(num)
      }}
      className="input input-bordered input-sm w-20 bg-gray-50"
    />
  )
}
