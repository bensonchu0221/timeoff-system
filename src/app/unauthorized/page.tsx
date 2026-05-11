import Link from "next/link"

export default function UnauthorizedPage() {
  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center text-center px-4">
      <div className="bg-white p-8 rounded-xl shadow-sm border border-red-100 max-w-md w-full">
        <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6 text-3xl">
          ⚠️
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">登入失敗</h1>
        <p className="text-gray-600 mb-6">
          沒有系統使用權限，請聯絡 HR 人資為您建立帳號。
        </p>
        <Link 
          href="/"
          className="block w-full py-2 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-md font-medium transition"
        >
          返回首頁
        </Link>
      </div>
    </div>
  )
}
