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
  if (!session?.user) redirect("/")

  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
  })

  if (!user || (user.role !== "MANAGER" && user.role !== "ADMIN")) {
    return <div className="p-6 text-red-500">權限不足：您必須是主管或管理員。</div>
  }

  // 決定要顯示誰的資料
  const targetUsers = await prisma.user.findMany({
    where: user.role === "ADMIN" ? {} : {
      OR: [
        { id: user.id },
        { managerId: user.id }
      ]
    },
    orderBy: {
      department: 'asc'
    }
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
      />
    </div>
  )
}
