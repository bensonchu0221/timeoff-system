"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { useSession } from "next-auth/react"

// LIFF（LINE Front-end Framework）整合：
// - 一般瀏覽器：完全不介入，維持原本 Google 登入流程（isInClient() === false）。
// - LINE in-app browser：用 LINE 身份自動換取系統 session（免 Google）。
// SDK 用 dynamic import 延遲載入，不打進主 bundle，避免拖慢一般使用者。

const LiffContext = createContext<{ isLiff: boolean }>({ isLiff: false })

/** 元件可用此判斷目前是否在 LINE in-app browser（LIFF）內 */
export const useIsLiff = () => useContext(LiffContext).isLiff

const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID

export function LiffProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession()
  const [isLiff, setIsLiff] = useState(false)
  // 只有「在 LINE 內、且自動登入尚未完成」時才會 gate 畫面
  const [bootstrapping, setBootstrapping] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      // 未設定 LIFF_ID（例如本地未配置）→ 視為非 LIFF，直接放行
      if (!LIFF_ID) {
        setBootstrapping(false)
        return
      }
      try {
        const liff = (await import("@line/liff")).default
        await liff.init({ liffId: LIFF_ID })

        // 一般瀏覽器（非 LINE）→ 不介入
        if (!liff.isInClient()) {
          if (!cancelled) setBootstrapping(false)
          return
        }
        if (!cancelled) setIsLiff(true)

        // 已有 NextAuth session → 不需重複登入
        if (status === "authenticated") {
          if (!cancelled) setBootstrapping(false)
          return
        }
        // session 還在判定中 → 等 status 改變後 effect 重跑
        if (status === "loading") return

        // 尚未登入 LIFF → 觸發授權（會跳轉，回來後重新 init）
        if (!liff.isLoggedIn()) {
          liff.login()
          return
        }

        const idToken = liff.getIDToken()
        if (!idToken) {
          if (!cancelled) {
            setMessage("無法取得 LINE 身份，請關閉後重新開啟。")
            setBootstrapping(false)
          }
          return
        }

        const res = await fetch("/api/auth/line", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        })
        const data = await res.json()
        if (cancelled) return

        if (data.status === "ok") {
          // set cookie 後整頁 reload：讓 SessionProvider 重新讀到新 session，
          // server / client 狀態一致（reload 後 status 會變 authenticated，spinner 自然收掉）
          window.location.reload()
          return
        } else if (data.status === "unbound") {
          setMessage(
            "您的 LINE 尚未綁定系統帳號。\n請先在電腦上用公司 Google 帳號登入系統，到「個人設定」取得綁定碼完成綁定。"
          )
          setBootstrapping(false)
        } else if (data.status === "terminated") {
          setMessage("您的帳號已停用，如有疑問請聯絡管理員。")
          setBootstrapping(false)
        } else {
          setMessage("登入失敗，請稍後再試。")
          setBootstrapping(false)
        }
      } catch (err) {
        // LIFF 失敗絕不可擋住一般瀏覽器使用者：只記 log、放行
        console.error("LIFF init/login error:", err)
        if (!cancelled) setBootstrapping(false)
      }
    }

    bootstrap()
    return () => {
      cancelled = true
    }
  }, [status])

  // LINE 內自動登入進行中 → 全頁 spinner，避免「未登入畫面」一閃
  if (isLiff && bootstrapping) {
    return <FullScreen>{<Spinner />}</FullScreen>
  }
  if (isLiff && message) {
    return (
      <FullScreen>
        <p className="text-center text-gray-600 whitespace-pre-line px-6">{message}</p>
      </FullScreen>
    )
  }

  return <LiffContext.Provider value={{ isLiff }}>{children}</LiffContext.Provider>
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background)]">
      {children}
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex flex-col items-center gap-3 text-gray-500">
      <span className="loading loading-spinner loading-lg" />
      <span className="text-sm">登入中…</span>
    </div>
  )
}
