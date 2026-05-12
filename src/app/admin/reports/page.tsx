import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"

export const metadata = {
  title: "報表下載 | Timeoff",
}

export default async function ReportsPage() {
  const session = await auth()
  if (!session?.user) redirect("/")

  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
  })

  if (!user || user.role !== "ADMIN") {
    return <div className="p-6 text-red-500">權限不足：您必須是管理員才能下載報表。</div>
  }

  const currentYear = new Date().getFullYear()
  const availableYears = [currentYear - 1, currentYear, currentYear + 1]

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">報表下載</h1>
        <p className="mt-1 text-sm text-gray-500">
          您可以在此下載員工的假別額度與請假紀錄。
        </p>
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <h2 className="text-lg font-medium mb-4">年度報表匯出</h2>
        <p className="text-sm text-gray-600 mb-6">
          系統會為每位員工產生一份獨立的 Excel 檔案（包含基本資料、假別額度與本年度請假明細），並打包為單一 ZIP 壓縮檔供您下載。
        </p>

        <form action="/api/reports/download" method="GET" className="flex items-end gap-4 bg-gray-50 p-4 rounded-md border border-gray-100 w-fit">
          <div>
            <label htmlFor="year" className="block text-sm font-medium text-gray-700 mb-1">
              選擇年度
            </label>
            <select
              id="year"
              name="year"
              defaultValue={currentYear}
              className="block w-32 rounded-md border-gray-300 shadow-sm focus:border-[var(--brand-primary)] focus:ring-[var(--brand-primary)] sm:text-sm px-3 py-2 border"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year} 年</option>
              ))}
            </select>
          </div>
          
          <button
            type="submit"
            className="bg-[var(--brand-primary)] text-white px-4 py-2 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition"
          >
            下載 ZIP 報表包
          </button>
        </form>
      </div>
    </div>
  )
}
