import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { getUserLeaveBalance } from "@/lib/leave-utils"
import { formatTaipeiDate, startOfYearUTC } from "@/lib/date-format"
import ExcelJS from "exceljs"
import JSZip from "jszip"

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const adminUser = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (adminUser?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const yearParam = searchParams.get("year")
    const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()

    if (isNaN(year)) {
      return NextResponse.json({ error: "Invalid year parameter" }, { status: 400 })
    }

    // 報表只列在職員工，離職者另需手動查詢歷史
    const users = await prisma.user.findMany({ where: { terminatedDate: null }, orderBy: { name: "asc" } })
    const leaveTypes = await prisma.leaveType.findMany({ where: { isActive: true } })

    const zip = new JSZip()

    for (const user of users) {
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet("員工請假明細")

      // --- Section 1: User Info ---
      sheet.addRow(["【員工基本資料】"])
      sheet.addRow(["姓名", user.name || "未設定"])
      sheet.addRow(["Email", user.email])
      sheet.addRow(["部門", user.department || "未設定"])
      sheet.addRow(["角色", user.role === "ADMIN" ? "管理員" : user.role === "MANAGER" ? "主管" : "員工"])
      sheet.addRow([]) // empty row

      // --- Section 2: Leave Balances ---
      sheet.addRow(["【假別額度表】"])
      sheet.addRow(["假別", "剩餘天數", "全年總天數"])
      
      const balancesList = await Promise.all(
        leaveTypes.map(async (lt) => {
          const bal = await getUserLeaveBalance(user.id, lt.id, year)
          return { name: lt.name, ...bal }
        })
      )

      for (const b of balancesList) {
        sheet.addRow([b.name, b.remaining, b.total])
      }
      sheet.addRow([]) // empty row

      // --- Section 3: Leave Requests ---
      sheet.addRow([`【${year} 年度請假單清單】`])
      sheet.addRow(["申請時間", "假別", "開始日期", "結束日期", "請假天數", "時段", "事由", "狀態"])

      const requests = await prisma.leaveRequest.findMany({
        where: {
          userId: user.id,
          startDate: {
            gte: startOfYearUTC(year),
            lt: startOfYearUTC(year + 1)
          }
        },
        include: { leaveType: true },
        orderBy: { startDate: 'desc' }
      })

      for (const req of requests) {
        sheet.addRow([
          req.createdAt.toLocaleString('zh-TW'),
          req.leaveType.name,
          formatTaipeiDate(req.startDate),
          formatTaipeiDate(req.endDate),
          req.durationDays,
          req.partOfDay === 'ALL_DAY' ? '全天' : req.partOfDay === 'MORNING' ? '上半天' : '下半天',
          req.reason || "",
          req.status === 'APPROVED' ? '已核准' :
          req.status === 'PENDING' ? '待審核' :
          req.status === 'REJECTED' ? '已駁回' :
          req.status === 'CANCELLED' ? '已銷假' : req.status
        ])
      }

      // Column widths
      sheet.getColumn(1).width = 25
      sheet.getColumn(2).width = 20
      sheet.getColumn(3).width = 15
      sheet.getColumn(4).width = 15
      sheet.getColumn(5).width = 10
      sheet.getColumn(6).width = 10
      sheet.getColumn(7).width = 30
      sheet.getColumn(8).width = 15

      const buffer = await workbook.xlsx.writeBuffer()
      const fileName = `timeoff_${user.name || '未命名'}_${year}.xlsx`
      
      zip.file(fileName, buffer)
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" })

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="timeoff_reports_${year}.zip"`,
      },
    })

  } catch (error: any) {
    console.error("Report generation error:", error)
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 })
  }
}
