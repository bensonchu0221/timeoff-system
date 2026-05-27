"use client"

import { useTransition } from "react"
import toast from "react-hot-toast"
import { createUser } from "./actions"

type DepartmentOption = { id: string; name: string }

export function CreateUserForm({ departments }: { departments: DepartmentOption[] }) {
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const form = e.currentTarget

    startTransition(async () => {
      try {
        await createUser(formData)
        toast.success("已成功建立新員工！")
        form.reset()
      } catch (err: any) {
        toast.error(err.message || "建立失敗")
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-4 items-end bg-gray-50 p-4 rounded-md">
      <div>
        <label className="block text-xs font-medium text-gray-700">姓名（英文 / 暱稱）</label>
        <input type="text" name="name" required className="input input-bordered input-sm mt-1 w-32 bg-white" placeholder="Ming" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">中文姓名 (選填)</label>
        <input type="text" name="chineseName" className="input input-bordered input-sm mt-1 w-32 bg-white" placeholder="王小明" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">Email</label>
        <input type="email" name="email" required className="input input-bordered input-sm mt-1 w-48 bg-white" placeholder="ming@popin.cc" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">部門</label>
        <select name="departmentId" required defaultValue="" className="select select-bordered select-sm mt-1 w-32 bg-white">
          <option value="" disabled>請選擇</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">所屬公司</label>
        <select name="company" required defaultValue="" className="select select-bordered select-sm mt-1 w-32 bg-white">
          <option value="" disabled>請選擇</option>
          <option value="POPIN">博英 (POPIN)</option>
          <option value="BROADCIEL">鉑芯 (BROADCIEL)</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">角色</label>
        <select name="role" className="select select-bordered select-sm mt-1 w-32 bg-white">
          <option value="EMPLOYEE">員工</option>
          <option value="MANAGER">主管</option>
          <option value="ADMIN">管理員</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">性別</label>
        <div className="join mt-2">
          <input
            type="radio"
            name="gender"
            value="MALE"
            aria-label="男"
            className="join-item btn btn-sm checked:bg-gray-300 checked:text-gray-800 checked:border-gray-400 hover:checked:bg-gray-400"
          />
          <input
            type="radio"
            name="gender"
            value="FEMALE"
            aria-label="女"
            defaultChecked
            className="join-item btn btn-sm checked:bg-gray-300 checked:text-gray-800 checked:border-gray-400 hover:checked:bg-gray-400"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">到職日</label>
        <input type="date" name="hireDate" className="input input-bordered input-sm mt-1 w-40 bg-white" />
      </div>
      <button 
        type="submit" 
        disabled={isPending}
        className="bg-[var(--brand-primary)] text-white px-4 py-2 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition disabled:bg-gray-400"
      >
        {isPending ? "新增中..." : "+ 新增員工"}
      </button>
    </form>
  )
}
