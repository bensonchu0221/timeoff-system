import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"

import { CreateDepartmentForm } from "./Forms"
import { DepartmentTable, DepartmentRow } from "./DepartmentTable"

export const metadata = {
  title: "部門管理 | Timeoff",
}

export default async function AdminDepartmentsPage() {
  const session = await auth()
  if (!session?.user) redirect("/")

  const me = await prisma.user.findUnique({
    where: { email: session.user.email! },
  })
  if (!me || me.role !== "ADMIN") {
    return <div className="p-6 text-red-500">權限不足：您必須是管理員才能管理部門。</div>
  }

  const departments = await prisma.department.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { users: true } } },
  })

  const rows: DepartmentRow[] = departments.map((d) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    sortOrder: d.sortOrder,
    isActive: d.isActive,
    userCount: d._count.users,
  }))

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">部門管理</h1>
        <p className="mt-1 text-sm text-gray-500">
          建立、調整、停用公司部門。員工建立 / 編輯時會從此清單選擇所屬部門。
        </p>
      </div>

      <div className="bg-white rounded-lg shadow border border-gray-200 p-6">
        <CreateDepartmentForm />
        <DepartmentTable rows={rows} />
      </div>
    </div>
  )
}
