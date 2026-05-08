"use client"

import { signIn, signOut, useSession } from "next-auth/react"

export function UserAuth() {
  const { data: session, status } = useSession()

  if (status === "loading") {
    return <div className="text-sm">載入中...</div>
  }

  if (session && session.user) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {session.user.image && (
            <img 
              src={session.user.image} 
              alt="Avatar" 
              className="w-8 h-8 rounded-full"
            />
          )}
          <div className="flex flex-col text-sm">
            <span className="font-semibold">{session.user.name}</span>
            <span className="text-xs text-blue-200">{(session.user as any).role}</span>
          </div>
        </div>
        <button
          onClick={() => signOut()}
          className="text-sm bg-white text-[var(--brand-primary)] px-3 py-1.5 rounded font-medium hover:bg-gray-100 transition-colors"
        >
          登出
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => signIn("google")}
      className="text-sm bg-white text-[var(--brand-primary)] px-4 py-2 rounded font-medium shadow hover:bg-gray-100 transition-colors"
    >
      使用 Google 登入
    </button>
  )
}
