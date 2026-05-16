"use client"

import { useEffect, useRef, useState } from "react"
import { UpdateBalanceForm } from "./Forms"

type Props = {
  leaveTypes: { id: string; name: string }[]
  userBalances: {
    user: { id: string; name: string | null; email: string }
    balances: { id: string; total: number; remaining: number }[]
  }[]
}

// 員工額度覆寫表：sticky 左欄會在「往右捲動時」把 email 淡出，僅留名字，
// 讓右側 input 區可視範圍變大；捲回最左邊再淡入 email。
export function BalancesTable({ leaveTypes, userBalances }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onScroll = () => {
      // 60 px 是保守 threshold；超過視為「已往右捲」
      setCollapsed(el.scrollLeft > 60)
    }
    onScroll()
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div ref={wrapRef} className="overflow-x-auto">
      <table className="min-w-max w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-500 sticky left-0 bg-gray-50 z-10">員工</th>
            {leaveTypes.map((lt) => (
              <th key={lt.id} className="px-4 py-3 text-left font-medium text-gray-500 border-l border-gray-200 min-w-[200px]">
                {lt.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {userBalances.map(({ user, balances }) => (
            <tr key={user.id} className="hover:bg-gray-50">
              <td className="px-4 py-4 sticky left-0 bg-white z-10 align-top">
                <div className="font-medium text-gray-900 whitespace-nowrap">{user.name || "未設定"}</div>
                <div
                  className={`text-xs text-gray-500 overflow-hidden transition-all duration-300 ease-out whitespace-nowrap ${
                    collapsed ? "max-h-0 max-w-0 opacity-0 mt-0" : "max-h-6 max-w-xs opacity-100 mt-0.5"
                  }`}
                >
                  {user.email}
                </div>
              </td>

              {balances.map((b) => (
                <td key={b.id} className="px-4 py-4 border-l border-gray-100">
                  <UpdateBalanceForm
                    userId={user.id}
                    leaveTypeId={b.id}
                    defaultTotal={b.total}
                    remaining={b.remaining}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
