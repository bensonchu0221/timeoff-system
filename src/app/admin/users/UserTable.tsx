"use client"

import { Role, Company } from "@prisma/client"
import { useState, useRef, useEffect, useTransition } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  updateUserRole,
  updateUserManager,
  updateUserHireDate,
  updateUserGender,
  updateUserTerminatedDate,
  updateUserChineseName,
  updateUserDepartment,
  updateUserCompany,
  setFinalApprover,
} from "./actions"
import { AnnualLeaveCell, RecalcBox } from "./AnnualLeaveCell"
import { applyRecalcAction } from "@/app/admin/annual-grant-actions"
import type { RecalcChange } from "@/lib/annual-grant"
import toast from "react-hot-toast"

type UserNode = {
  id: string
  name: string | null
  chineseName: string | null
  email: string
  role: Role
  departmentId: string | null
  department: { id: string; name: string } | null
  company: Company | null
  managerId: string | null
  isFinalApprover: boolean
  hireDate: Date | null
  gender: string
  terminatedDate: Date | null
  annualLeaveOpeningBalance: number | null
  annualLeaveOpeningAt: Date | null
  annualLeaveOpeningB: number | null
  annualLeaveOpeningR: number | null
}

type DepartmentOption = { id: string; name: string }

export function UserTable({ users, departments, remainingByUser, nextYear }: {
  users: UserNode[]; departments: DepartmentOption[]; remainingByUser: Record<string, number>; nextYear: number
}) {
  const [isPending, startTransition] = useTransition()
  // 改到職日後若已有系統發放紀錄，顯示重算預覽（HR 決定要不要重算）
  const [recalcFor, setRecalcFor] = useState<{ userId: string; changes: RecalcChange[] } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isScrolled, setIsScrolled] = useState(false)
  const scrollIntervalRef = useRef<number | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => setIsScrolled(el.scrollLeft > 10)
    el.addEventListener("scroll", onScroll)
    return () => el.removeEventListener("scroll", onScroll)
  }, [])

  // hover 浮動按鈕時持續捲動，移開即停
  const startScroll = (dx: number) => {
    stopScroll()
    scrollIntervalRef.current = window.setInterval(() => {
      containerRef.current?.scrollBy({ left: dx })
    }, 16)
  }
  const stopScroll = () => {
    if (scrollIntervalRef.current !== null) {
      clearInterval(scrollIntervalRef.current)
      scrollIntervalRef.current = null
    }
  }
  useEffect(() => () => stopScroll(), [])

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
    <div className="relative">
    <div ref={containerRef} className="bg-white rounded-lg shadow overflow-x-auto border border-gray-200">
      <table className="min-w-max w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="sticky left-0 z-30 bg-gray-50 border-r border-gray-200 px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">員工</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">中文姓名</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">角色權限</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">性別</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">部門</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">所屬公司</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">直屬主管</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">終審者(Boss)</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">到職日</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">特休</th>
            <th className="px-6 py-3 text-left font-medium text-gray-500 uppercase tracking-wider">離職日</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {users.map((user) => {
            const isTerminated = !!user.terminatedDate
            return (
              <tr key={user.id} className={isTerminated ? "bg-gray-50 opacity-60" : ""}>
                <td className={`sticky left-0 z-10 border-r border-gray-200 align-top whitespace-nowrap transition-all duration-300 ${isTerminated ? "bg-gray-50" : "bg-white"} ${isScrolled ? "px-1 py-1" : "px-6 py-4"}`}>
                  <div className="flex flex-col gap-1 overflow-hidden">
                    <span className="font-medium text-gray-900 flex items-center gap-2 whitespace-nowrap">
                      <span className={`transition-all duration-300 ${isScrolled ? "max-w-[68px] truncate block" : ""}`}>{user.name || "未設定名稱"}</span>
                      {user.chineseName && (
                        <span className={`text-xs text-gray-400 font-normal overflow-hidden whitespace-nowrap transition-all duration-300 ${isScrolled ? "max-w-0 opacity-0" : "max-w-xs opacity-100"}`}>
                          {user.chineseName}
                        </span>
                      )}
                      {isTerminated && (
                        <span className={`text-[10px] rounded bg-gray-200 text-gray-600 font-normal overflow-hidden whitespace-nowrap transition-all duration-300 ${isScrolled ? "max-w-0 opacity-0 px-0 py-0" : "max-w-xs opacity-100 px-2 py-0.5"}`}>
                          已離職
                        </span>
                      )}
                    </span>
                    <span className={`text-gray-500 whitespace-nowrap overflow-hidden transition-all duration-300 ${isScrolled ? "max-w-0 max-h-0 opacity-0" : "max-w-xs max-h-8 opacity-100"}`}>
                      {user.email}
                    </span>
                    {/* 以此人視角檢視：POST /api/admin/impersonate?email=...；用 form 提交確保走 server-side redirect */}
                    <form action={`/api/admin/impersonate?email=${encodeURIComponent(user.email)}`} method="POST" className={`overflow-hidden transition-all duration-300 ${isScrolled ? "max-w-0 max-h-0 opacity-0" : "max-w-xs max-h-8 opacity-100"}`}>
                      <button
                        type="submit"
                        className="text-[11px] text-amber-700 hover:text-amber-900 hover:underline"
                        title="切換到此員工視角檢視畫面（read-only，無法寫入）"
                      >
                        以此人視角檢視 →
                      </button>
                    </form>
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
                  <select
                    disabled={isPending}
                    value={user.departmentId ?? ""}
                    onChange={(e) => wrap(() => updateUserDepartment(user.id, e.target.value))}
                    className="select select-bordered select-sm w-full bg-gray-50"
                  >
                    {/* 既有 user 的 department 可能是已停用部門，補一個 disabled 選項顯示目前值 */}
                    {user.department && !departments.some((d) => d.id === user.department!.id) && (
                      <option value={user.department.id} disabled>
                        {user.department.name}（已停用）
                      </option>
                    )}
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <select
                    disabled={isPending}
                    value={user.company ?? ""}
                    onChange={(e) => wrap(() => updateUserCompany(user.id, e.target.value as Company))}
                    className="select select-bordered select-sm w-full bg-gray-50"
                  >
                    <option value="" disabled>請選擇</option>
                    <option value="POPIN">博英 (POPIN)</option>
                    <option value="BROADCIEL">鉑芯 (BROADCIEL)</option>
                  </select>
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
                <td className="px-6 py-4 whitespace-nowrap align-top text-center">
                  <input
                    type="checkbox"
                    disabled={isPending || isTerminated}
                    checked={user.isFinalApprover}
                    onChange={(e) => wrap(() => setFinalApprover(user.id, e.target.checked))}
                    className="checkbox checkbox-sm"
                    title="設為全公司唯一終審者（Boss）；勾選會自動取消其他人"
                  />
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <input
                    type="date"
                    disabled={isPending}
                    // 離開欄位才存：打字中途（例 0002-01-15）就存會誤觸新人發放
                    key={`hire-${user.id}-${user.hireDate?.toISOString() ?? ""}`}
                    defaultValue={user.hireDate ? user.hireDate.toISOString().split("T")[0] : ""}
                    onBlur={(e) => {
                      const v = e.target.value
                      if (v === (user.hireDate ? user.hireDate.toISOString().split("T")[0] : "")) return
                      startTransition(async () => {
                        try {
                          const r = await updateUserHireDate(user.id, v)
                          toast.success(r.message)
                          if (r.recalc.length > 0) setRecalcFor({ userId: user.id, changes: r.recalc })
                        } catch (err) { toast.error((err as Error).message || "更新失敗") }
                      })
                    }}
                    className="input input-bordered input-sm w-full bg-gray-50"
                  />
                </td>
                <td className="px-6 py-4 align-top">
                  <AnnualLeaveCell userId={user.id} remaining={remainingByUser[user.id]} nextYear={nextYear} disabled={isPending} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <input
                    type="date"
                    disabled={isPending}
                    key={`term-${user.id}-${user.terminatedDate?.toISOString() ?? ""}`}
                    defaultValue={user.terminatedDate ? user.terminatedDate.toISOString().split("T")[0] : ""}
                    onBlur={(e) => {
                      const v = e.target.value
                      if (v === (user.terminatedDate ? user.terminatedDate.toISOString().split("T")[0] : "")) return
                      wrap(() => updateUserTerminatedDate(user.id, v))
                    }}
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
      {recalcFor && (
        <div className="fixed bottom-4 right-4 z-40 w-96 bg-white shadow-xl rounded-lg p-4 text-xs">
          <RecalcBox
            changes={recalcFor.changes}
            onClose={() => { setRecalcFor(null); toast("到職日已儲存；發放紀錄未變更，可之後在特休欄重算") }}
            onApply={(reason) => startTransition(async () => {
              try { toast.success((await applyRecalcAction(recalcFor.userId, reason)).message); setRecalcFor(null) }
              catch (err) { toast.error((err as Error).message) }
            })}
          />
        </div>
      )}
      {/* 浮動左右捲動按鈕（PC 限定，hover 持續捲動） */}
      <button
        type="button"
        onMouseEnter={() => startScroll(-12)}
        onMouseLeave={stopScroll}
        className="hidden lg:flex absolute -left-6 lg:-left-8 xl:-left-12 top-6 -translate-y-1/2 items-center justify-center w-10 h-10 rounded-full bg-white/70 backdrop-blur shadow border border-gray-200 hover:bg-white text-gray-700 z-40 transition"
        aria-label="向左捲動"
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        type="button"
        onMouseEnter={() => startScroll(12)}
        onMouseLeave={stopScroll}
        className="hidden lg:flex absolute -right-6 lg:-right-8 xl:-right-12 top-6 -translate-y-1/2 items-center justify-center w-10 h-10 rounded-full bg-white/70 backdrop-blur shadow border border-gray-200 hover:bg-white text-gray-700 z-40 transition"
        aria-label="向右捲動"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
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

