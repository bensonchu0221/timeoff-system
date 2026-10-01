"use client"

import { useState, useTransition } from "react"
import toast from "react-hot-toast"
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { reorderLeaveTypes } from "./actions"
import { DeleteLeaveTypeButton, ToggleRequireProofSwitch } from "./Forms"

type LeaveTypeRow = { id: string; name: string; defaultDays: number; isPaid: boolean; requireProof: boolean }

// grip 把手 icon（與 Q&A 管理頁相同的 inline SVG）
function GripIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="6" cy="3" r="1.3" />
      <circle cx="10" cy="3" r="1.3" />
      <circle cx="6" cy="8" r="1.3" />
      <circle cx="10" cy="8" r="1.3" />
      <circle cx="6" cy="13" r="1.3" />
      <circle cx="10" cy="13" r="1.3" />
    </svg>
  )
}

function SortableRow({ row }: { row: LeaveTypeRow }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id })
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`bg-white ${isDragging ? "relative z-10 shadow-lg ring-2 ring-[var(--brand-primary)]/30" : ""}`}
    >
      <td className="w-10 pl-3 pr-1 py-3">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`拖拉調整「${row.name}」的順序`}
          className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-grab active:cursor-grabbing touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]"
        >
          <GripIcon className="w-4 h-4" />
        </button>
      </td>
      <td className="px-4 py-3 font-medium">{row.name}</td>
      <td className="px-4 py-3">{row.defaultDays} 天</td>
      <td className="px-4 py-3">{row.isPaid ? "有" : "無"}</td>
      <td className="px-4 py-3">
        <ToggleRequireProofSwitch id={row.id} initial={row.requireProof} />
      </td>
      <td className="px-4 py-3">
        <DeleteLeaveTypeButton id={row.id} />
      </td>
    </tr>
  )
}

// 假別列表：拖拉左側把手調整順序，放開即儲存。
// 順序用在首頁額度、請假表單下拉（預設選第一個）、LINE 查詢、報表。
export function LeaveTypeTable({ leaveTypes }: { leaveTypes: LeaveTypeRow[] }) {
  const [rows, setRows] = useState(leaveTypes)
  const [, startTransition] = useTransition()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = rows.findIndex((r) => r.id === active.id)
    const newIdx = rows.findIndex((r) => r.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const before = rows
    const reordered = arrayMove(rows, oldIdx, newIdx)
    setRows(reordered)
    startTransition(async () => {
      try {
        toast.success((await reorderLeaveTypes(reordered.map((r) => r.id))).message)
      } catch (err) {
        toast.error((err as Error).message || "排序更新失敗")
        setRows(before) // 失敗還原
      }
    })
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="w-10 pl-3 pr-1 py-2"><span className="sr-only">排序</span></th>
            <th className="px-4 py-2 text-left font-medium text-gray-500">假別名稱</th>
            <th className="px-4 py-2 text-left font-medium text-gray-500">預設天數</th>
            <th className="px-4 py-2 text-left font-medium text-gray-500">支薪</th>
            <th className="px-4 py-2 text-left font-medium text-gray-500">證明文件</th>
            <th className="px-4 py-2 text-left font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => <SortableRow key={row.id} row={row} />)}
          </tbody>
        </SortableContext>
      </table>
    </DndContext>
  )
}
