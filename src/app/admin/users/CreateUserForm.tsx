"use client"

import { useTransition } from "react"
import toast from "react-hot-toast"
import { createUser } from "./actions"

export function CreateUserForm() {
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
        <label className="block text-xs font-medium text-gray-700">姓名</label>
        <input type="text" name="name" required className="mt-1 block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" placeholder="王小明" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">Email</label>
        <input type="email" name="email" required className="mt-1 block w-48 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" placeholder="ming@popin.cc" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">部門 (選填)</label>
        <input type="text" name="department" className="mt-1 block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border" placeholder="產品部" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700">角色</label>
        <select name="role" className="mt-1 block w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border">
          <option value="EMPLOYEE">員工 (EMPLOYEE)</option>
          <option value="MANAGER">主管 (MANAGER)</option>
          <option value="ADMIN">管理員 (ADMIN)</option>
        </select>
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
