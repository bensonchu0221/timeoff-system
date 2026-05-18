"use client"

import { UpdateOverrideRow } from "./Forms"

export type OverrideTableRow = {
  userId: string
  leaveTypeId: string
  userName: string | null
  userEmail: string
  leaveTypeName: string
  currentOverride: number
  latestOverrideYear: number
  baselineWithoutOverride: number
  remaining: number
}

type Props = {
  rows: OverrideTableRow[]
}

// 個人 override 列表：只顯示「DB 中有 UserLeaveBalance row」的員工 × 假別組合
// 同一組合若跨年有多筆，只顯示最新一筆（latestOverrideYear）
export function BalancesTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500 text-sm bg-gray-50 rounded-md">
        目前沒有任何 override 設定。所有員工皆走「公司前 2 年 / 政府勞基法 §38」基準。
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-500">員工</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">假別</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">設定年</th>
            <th className="px-4 py-3 text-left font-medium text-gray-500">Override 編輯</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <tr key={`${r.userId}:${r.leaveTypeId}`} className="hover:bg-gray-50 align-top">
              <td className="px-4 py-4">
                <div className="font-medium text-gray-900 whitespace-nowrap">{r.userName || "未設定"}</div>
                <div className="text-xs text-gray-500">{r.userEmail}</div>
              </td>
              <td className="px-4 py-4 whitespace-nowrap">{r.leaveTypeName}</td>
              <td className="px-4 py-4 whitespace-nowrap text-gray-500">{r.latestOverrideYear}</td>
              <td className="px-4 py-4">
                <UpdateOverrideRow
                  userId={r.userId}
                  leaveTypeId={r.leaveTypeId}
                  currentOverride={r.currentOverride}
                  baselineWithoutOverride={r.baselineWithoutOverride}
                  remaining={r.remaining}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
