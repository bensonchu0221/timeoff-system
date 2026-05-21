"use client"

import { useTransition } from "react"
import toast from "react-hot-toast"
import { createDepartment } from "./actions"

export function CreateDepartmentForm() {
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)

    startTransition(async () => {
      try {
        const result = await createDepartment(formData)
        if (result?.success) {
          toast.success(result.message)
          form.reset()
        }
      } catch (err: any) {
        toast.error(err.message || "新增失敗")
      }
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col md:flex-row md:flex-wrap md:items-end gap-3 md:gap-4 mb-6 bg-gray-50 p-4 rounded-md"
    >
      <div className="w-full md:w-auto">
        <label className="block text-xs font-medium text-gray-700">部門名稱</label>
        <input
          type="text"
          name="name"
          required
          className="mt-1 block w-full md:w-40 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
          placeholder="例如：產品部"
        />
      </div>
      <div className="w-full md:w-auto">
        <label className="block text-xs font-medium text-gray-700">代碼（選填）</label>
        <input
          type="text"
          name="code"
          className="mt-1 block w-full md:w-32 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
          placeholder="例如：PROD"
        />
      </div>
      <div className="w-full md:w-auto">
        <label className="block text-xs font-medium text-gray-700">排序</label>
        <input
          type="number"
          name="sortOrder"
          defaultValue={0}
          className="mt-1 block w-full md:w-24 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-3 py-2 border"
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="w-full md:w-auto bg-[var(--brand-primary)] text-white px-4 py-2 rounded-md hover:bg-[var(--brand-primary-dark)] text-sm font-medium transition disabled:bg-gray-400"
      >
        {isPending ? "新增中..." : "+ 新增部門"}
      </button>
    </form>
  )
}
