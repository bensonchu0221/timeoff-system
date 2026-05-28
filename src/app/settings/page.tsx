import { auth } from "@/auth"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"
import { LineBindingPanel, UnifiedNotifyPrefsPanel } from "./Panels"

export const metadata = {
  title: "個人設定 | Timeoff",
}

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/")

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      lineUserId: true,
      lineBindingCode: true,
      lineBindingExpiry: true,
      lineBoundAt: true,
      lineNotifyPrefs: true,
      emailNotifyPrefs: true,
    },
  })

  if (!user) redirect("/")

  // 過期的綁定碼不顯示給前端
  const codeExpired =
    user.lineBindingCode &&
    user.lineBindingExpiry &&
    user.lineBindingExpiry < new Date()

  const bindingCode = codeExpired ? null : user.lineBindingCode
  const bindingExpiry = codeExpired ? null : user.lineBindingExpiry

  const botBasicId = process.env.LINE_BOT_BASIC_ID || ""
  const isLineBound = !!user.lineUserId
  const isManager = user.role === "MANAGER" || user.role === "ADMIN"

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">個人設定</h1>
        <p className="mt-1 text-sm text-gray-500">
          綁定 LINE 帳號以接收即時推播，並可自訂哪些事件要收 Email 通知或 LINE 推播。
        </p>
      </div>

      <LineBindingPanel
        isBound={isLineBound}
        boundAt={user.lineBoundAt}
        bindingCode={bindingCode}
        bindingExpiry={bindingExpiry}
        botBasicId={botBasicId}
      />

      <UnifiedNotifyPrefsPanel
        emailPrefs={(user.emailNotifyPrefs as Record<string, boolean>) || {}}
        linePrefs={(user.lineNotifyPrefs as Record<string, boolean>) || {}}
        isLineBound={isLineBound}
        isManager={isManager}
      />
    </div>
  )
}
