import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { GanttChart } from "./GanttChart"

export const metadata = {
  title: "團隊請假甘特圖 | Timeoff",
}

export default async function GanttPage(props: { searchParams: Promise<{ month?: string }> }) {
  const searchParams = await props.searchParams;
  const session = await auth()
  // 未登入：帶 callbackUrl 讓登入後自動跳回 /gantt（email 連結點開時無 session 的情境）
  if (!session?.user) redirect("/?callbackUrl=/gantt")

  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
  })

  if (!user) {
    return <div className="p-6 text-red-500">找不到使用者資料。</div>
  }

  // 所有 role 都看全公司在職員工（透明化）；審核權限另由 canReview 控制
  const targetUsers = await prisma.user.findMany({
    where: { terminatedDate: null },
    include: { department: { select: { name: true } } },
    orderBy: [{ department: { sortOrder: "asc" } }, { name: "asc" }],
  })

  const userIds = targetUsers.map(u => u.id)

  // 根據搜尋參數決定起始與結束日期
  const today = new Date()
  let centerDate = new Date(today)

  if (searchParams.month) {
    const [year, month] = searchParams.month.split("-").map(Number)
    centerDate = new Date(year, month - 1, 15) // 置中於該月中間
  }

  // 顯示前後各 45 天 (共約三個月)
  const startDate = new Date(centerDate)
  startDate.setDate(centerDate.getDate() - 45)
  const endDate = new Date(centerDate)
  endDate.setDate(centerDate.getDate() + 45)

  const leaves = await prisma.leaveRequest.findMany({
    where: {
      userId: { in: userIds },
      status: { in: ["APPROVED", "PENDING"] },
      OR: [
        { startDate: { lte: endDate, gte: startDate } },
        { endDate: { lte: endDate, gte: startDate } },
        { startDate: { lte: startDate }, endDate: { gte: endDate } }
      ]
    },
    include: {
      leaveType: true
    }
  })

  // 產生 X 軸的日期陣列
  const days: Date[] = []
  const current = new Date(startDate)
  while (current <= endDate) {
    days.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }

  // 員工版不可審核 PENDING 假單；只有 MANAGER/ADMIN 才允許在格子點開審核 modal
  const canReview = user.role === "MANAGER" || user.role === "ADMIN"

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">團隊請假甘特圖</h1>
        <p className="mt-1 text-sm text-gray-500">
          顯示三個月內的請假狀況。按住滑鼠左鍵可左右拖曳，或使用上方按鈕切換月份。
        </p>
      </div>

      <GanttChart
        days={days}
        targetUsers={targetUsers}
        leaves={leaves}
        today={today}
        canReview={canReview}
      />
    </div>
  )
}
