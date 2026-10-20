"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { reviewLeave, adminCancelLeave } from "@/app/actions/leave"
import toast from "react-hot-toast"
import { LeaveRequest, LeaveType, PartOfDay } from "@prisma/client"
import { formatTaipeiDate } from "@/lib/date-format"

type LeaveWithRelations = LeaveRequest & {
  leaveType: LeaveType
}

// 莫蘭迪色系：核准用 #7A9A8A，待審核用 #A9ADA9（色塊與文字外框共用）
const APPROVED_COLOR = "#7A9A8A"
const PENDING_COLOR = "#A9ADA9"
// 半天三角形三個角的圓角半徑（px），與全天色塊 rounded-md 接近
const HALF_CORNER_RADIUS = 5

type Pt = [number, number]

// 圓角多邊形 SVG path：每個頂點用同一個半徑 r 的圓弧接起兩條邊（r = 0 為尖角），
// 銳角與直角看起來圓潤程度一致。切點距頂點 r / tan(θ/2)，不超過相鄰邊長的一半。
function roundedPolygonPath(points: Pt[], radii: number[]): string {
  const n = points.length
  let d = ""
  for (let i = 0; i < n; i++) {
    const [vx, vy] = points[i]
    const [px, py] = points[(i - 1 + n) % n]
    const [nx, ny] = points[(i + 1) % n]
    const v1: Pt = [px - vx, py - vy]
    const v2: Pt = [nx - vx, ny - vy]
    const l1 = Math.hypot(...v1)
    const l2 = Math.hypot(...v2)
    const angle = Math.acos((v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2))
    const t = Math.min(radii[i] / Math.tan(angle / 2), l1 / 2, l2 / 2)
    const r = t * Math.tan(angle / 2)
    const a: Pt = [vx + (v1[0] / l1) * t, vy + (v1[1] / l1) * t]
    const b: Pt = [vx + (v2[0] / l2) * t, vy + (v2[1] / l2) * t]
    // 順時針走的多邊形，圓弧 sweep 取外積方向
    const sweep = v1[0] * v2[1] - v1[1] * v2[0] < 0 ? 1 : 0
    d += `${i === 0 ? "M" : "L"}${a[0]},${a[1]} A${r},${r} 0 0 ${sweep} ${b[0]},${b[1]} `
  }
  return d + "Z"
}

export function GanttLeaveCell({
  leaveOnDay,
  isPending,
  canReview = true,
  isAdmin = false,
  userName,
  roundedLeft = true,
  roundedRight = true,
  extendLeft = false,
  extendRight = false,
  dayPart,
  pairedHalf = false,
}: {
  leaveOnDay: LeaveWithRelations,
  isPending: boolean,
  canReview?: boolean,
  isAdmin?: boolean,
  userName: string,
  roundedLeft?: boolean,
  roundedRight?: boolean,
  extendLeft?: boolean,
  extendRight?: boolean,
  // 這一格是全天還是上/下半天；預設取假單本身的 partOfDay
  dayPart?: PartOfDay,
  // 同一格另有一張互補的半天單（上午 + 下午）→ 文字各往自己的三角偏，避免疊字
  pairedHalf?: boolean,
}) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [isPendingAction, startTransition] = useTransition()

  // 待審且有審核權 → 可開核准/駁回；admin → 可開銷假。兩者皆可時 modal 同時顯示。
  const canCancel = isAdmin
  const clickable = (isPending && canReview) || canCancel

  const handleReview = (status: "APPROVED" | "REJECTED") => {
    setIsOpen(false)
    startTransition(async () => {
      try {
        const res = await reviewLeave(leaveOnDay.id, status)
        if (res?.success) toast.success(`假單已${status === 'APPROVED' ? '核准' : '駁回'}`)
      } catch (err: any) {
        toast.error(err.message || "更新失敗")
      }
    })
  }

  // admin 銷假：刪附件、不發任何通知；破壞性操作，需二次確認
  const handleCancel = () => {
    if (!confirm("確定要銷假嗎？將一併刪除此假單的附件，且不會發送任何通知。")) return
    setIsOpen(false)
    startTransition(async () => {
      try {
        const res = await adminCancelLeave(leaveOnDay.id)
        if (res?.success) {
          toast.success("已銷假")
          router.refresh()
        }
      } catch (err: any) {
        toast.error(err.message || "銷假失敗")
      }
    })
  }

  const color = isPending ? PENDING_COLOR : APPROVED_COLOR

  // 圓角規則：只有假單真正端點（startDate/endDate）才用圓角；中間（含跨假日的兩側）為方角
  // 延伸規則：相鄰那格是同色塊才向外延伸 -1px 蓋過 td border；接空白格則不延伸
  const roundedClass =
    roundedLeft && roundedRight ? "rounded-md" :
    roundedLeft ? "rounded-l-md" :
    roundedRight ? "rounded-r-md" :
    ""
  const leftClass = extendLeft ? "-left-px" : "left-0"
  const rightClass = extendRight ? "-right-px" : "right-0"

  // 上半天：左上三角；下半天：右下三角。兩張互補單沿對角線拼滿整格。
  // 三角形用 SVG 依格子實際大小畫，三個角同一個圓角半徑；接著相鄰色塊的那一側不圓角。
  const part = dayPart ?? leaveOnDay.partOfDay
  const isHalfDay = part !== "ALL_DAY"
  const isMorning = part === "MORNING"
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = boxRef.current
    if (!isHalfDay || !el) return
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [isHalfDay])

  let trianglePath: string | null = null
  if (isHalfDay && box) {
    const { w, h } = box
    const r = HALF_CORNER_RADIUS
    // 頂點順時針；左緣頂點看 roundedLeft、右緣頂點看 roundedRight
    const L = roundedLeft ? r : 0
    const R = roundedRight ? r : 0
    trianglePath = isMorning
      ? roundedPolygonPath([[0, 0], [w, 0], [0, h]], [L, R, L])
      : roundedPolygonPath([[w, 0], [w, h], [0, h]], [R, R, L])
  }

  // 文字：與全天一樣 text-sm 置中；外加一圈色塊同色的外框，壓到白底時也看得清楚。
  // 同格有上午 + 下午兩張時，各往自己的三角偏，避免疊字。
  // 16 個方向、半徑 2px 的實心外框，再加一層柔邊
  const textHalo = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * 2 * Math.PI
    return `${(2 * Math.cos(a)).toFixed(2)}px ${(2 * Math.sin(a)).toFixed(2)}px 0 ${color}`
  }).concat(`0 0 3px ${color}`).join(", ")
  const textPos = !isHalfDay || !pairedHalf ? { left: "50%", top: "50%" } : isMorning ? { left: "30%", top: "32%" } : { left: "70%", top: "68%" }

  const title = `${leaveOnDay.leaveType.name} (${part === "ALL_DAY" ? "全天" : isMorning ? "上半天" : "下半天"}) - ${leaveOnDay.status}`
  const label = leaveOnDay.leaveType.name.substring(0, 1)
  const interactiveClass = `${clickable ? "cursor-pointer hover:opacity-80" : ""} ${isPendingAction ? "opacity-50 animate-pulse" : ""}`
  const openModal = () => { if (clickable) setIsOpen(true) }

  const block = isHalfDay ? (
    <div ref={boxRef} className={`absolute top-0 bottom-0 ${leftClass} ${rightClass} pointer-events-none`}>
      {trianglePath && (
        <svg width="100%" height="100%" className="absolute inset-0 overflow-visible">
          {/* 只有三角形本身可點；互補的另一張單點得到自己那半 */}
          <path d={trianglePath} fill={color} onClick={openModal} className={`pointer-events-auto ${interactiveClass}`}>
            <title>{title}</title>
          </path>
        </svg>
      )}
      <span
        className="absolute -translate-x-1/2 -translate-y-1/2 text-sm font-semibold leading-none text-white select-none"
        style={{ ...textPos, textShadow: textHalo }}
      >
        {label}
      </span>
    </div>
  ) : (
    <div
      onClick={openModal}
      className={`absolute top-0 bottom-0 ${leftClass} ${rightClass} ${roundedClass} items-center justify-center text-sm font-semibold flex text-white select-none ${interactiveClass}`}
      style={{ backgroundColor: color }}
      title={title}
    >
      {label}
    </div>
  )

  return (
    <>
      {block}

      {isOpen && clickable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/30 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl border border-gray-100 p-5 max-w-sm w-full flex flex-col gap-4"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-gray-900">假單 - {userName}</h3>
            <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-md border border-gray-100">
              <p className="mb-1"><strong>假別：</strong>{leaveOnDay.leaveType.name} ({leaveOnDay.partOfDay === 'ALL_DAY' ? '全天' : leaveOnDay.partOfDay === 'MORNING' ? '上半天' : '下半天'})</p>
              <p className="mb-1"><strong>期間：</strong>{formatTaipeiDate(leaveOnDay.startDate)} ~ {formatTaipeiDate(leaveOnDay.endDate)}</p>
              <p><strong>天數：</strong>{leaveOnDay.durationDays} 天</p>
              {leaveOnDay.reason && <p className="mt-2 text-gray-500 italic">"{leaveOnDay.reason}"</p>}
            </div>
            
            <div className="flex gap-3 items-center mt-2 flex-wrap">
              {/* admin 限定：銷假（刪附件、不發通知）。靠左、紅色，與右側審核動作區隔 */}
              {canCancel && (
                <button
                  onClick={handleCancel}
                  disabled={isPendingAction}
                  className="px-4 py-2 border border-[#C48F8B] text-[#a36863] rounded-md text-sm hover:bg-[#C48F8B]/10 transition font-medium disabled:opacity-50"
                >
                  銷假
                </button>
              )}
              <div className="flex gap-3 justify-end ml-auto">
                <button
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-md text-sm transition font-medium"
                >
                  關閉
                </button>
                {isPending && canReview && (
                  <>
                    <button
                      onClick={() => handleReview("REJECTED")}
                      className="px-4 py-2 bg-[#C48F8B] text-white rounded-md text-sm hover:bg-[#b0807c] transition font-medium shadow-sm"
                    >
                      駁回
                    </button>
                    <button
                      onClick={() => handleReview("APPROVED")}
                      className="px-4 py-2 bg-[#7A9A8A] text-white rounded-md text-sm hover:bg-[#6c8879] transition font-medium shadow-sm"
                    >
                      核准
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
