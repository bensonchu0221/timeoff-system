import { Fragment } from "react"

// 兩階段審核：橫式進度圖（像出貨進度）。放在首頁假單列表，讓員工知道審到哪一關。
// 步驟：申請 → 主管審核 →（Boss 終審，僅兩階段）→ 完成
type StepState = "done" | "current" | "rejected" | "upcoming"

const dotClass = (s: StepState) =>
  s === "done" ? "bg-[#7A9A8A] text-white border-[#7A9A8A]"
    : s === "rejected" ? "bg-[#C48F8B] text-white border-[#C48F8B]"
      : s === "current" ? "bg-white text-[#6d716f] border-[#A9ADA9]"
        : "bg-gray-100 text-gray-400 border-gray-200"

const labelClass = (s: StepState) =>
  s === "done" ? "text-[#5c7a6b]"
    : s === "rejected" ? "text-[#a36863]"
      : s === "current" ? "text-[#6d716f] font-medium"
        : "text-gray-400"

const connectorClass = (s: StepState) =>
  s === "done" ? "bg-[#7A9A8A]" : s === "rejected" ? "bg-[#C48F8B]" : "bg-gray-200"

export function LeaveApprovalSteps({
  status,
  firstApprovedAt,
  secondApproverId,
}: {
  status: string
  firstApprovedAt: Date | null
  secondApproverId: string | null
}) {
  const isTwoStage = secondApproverId != null

  let managerState: StepState
  let bossState: StepState
  let doneState: StepState

  if (status === "APPROVED") {
    managerState = "done"; bossState = "done"; doneState = "done"
  } else if (status === "REJECTED") {
    // firstApprovedAt 非 null → 在 Boss 二審被駁；否則在主管一審被駁
    if (firstApprovedAt) { managerState = "done"; bossState = "rejected"; doneState = "upcoming" }
    else { managerState = "rejected"; bossState = "upcoming"; doneState = "upcoming" }
  } else {
    // PENDING：firstApprovedAt 非 null → 目前在 Boss 二審；否則在主管一審
    if (firstApprovedAt) { managerState = "done"; bossState = "current"; doneState = "upcoming" }
    else { managerState = "current"; bossState = "upcoming"; doneState = "upcoming" }
  }

  const steps: { label: string; state: StepState }[] = [
    { label: "申請", state: "done" },
    { label: "主管審核", state: managerState },
    ...(isTwoStage ? [{ label: "Boss 終審", state: bossState }] : []),
    { label: "完成", state: doneState },
  ]

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, i) => (
        <Fragment key={i}>
          {i > 0 && <div className={`h-0.5 w-4 rounded ${connectorClass(steps[i - 1].state)}`} />}
          <div className="flex flex-col items-center gap-0.5">
            <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] leading-none ${dotClass(step.state)}`}>
              {step.state === "done" ? "✓" : step.state === "rejected" ? "✕" : i + 1}
            </div>
            <span className={`text-[10px] whitespace-nowrap ${labelClass(step.state)}`}>{step.label}</span>
          </div>
        </Fragment>
      ))}
    </div>
  )
}
