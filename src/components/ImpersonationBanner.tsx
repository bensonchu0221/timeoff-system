import { auth } from "@/auth"

// 全站 sticky banner；只有 admin 處於 impersonate 模式時才顯示
// 提示「正在以 X 的視角瀏覽」+ 表單 POST 停止 impersonate（清 cookie 後 redirect）
export async function ImpersonationBanner() {
  const session = await auth()
  if (!session || !(session as any).impersonating) return null

  const target = session.user as { name?: string | null; email?: string | null; chineseName?: string | null }
  const actor = (session as any).realActor as { name?: string | null; email?: string | null } | undefined
  const targetLabel = target?.chineseName || target?.name || target?.email || "(未知)"
  const actorLabel = actor?.name || actor?.email || "admin"

  return (
    <div className="sticky top-0 z-40 bg-amber-500 text-white shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex items-center justify-between gap-4 text-sm">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold whitespace-nowrap">Impersonate 模式</span>
          <span className="opacity-90 truncate">
            {actorLabel} 正在以 <span className="font-semibold">{targetLabel}</span> 的視角瀏覽（寫入操作已被禁用）
          </span>
        </div>
        <form action="/api/admin/impersonate/stop" method="POST">
          <button
            type="submit"
            className="bg-white/15 hover:bg-white/25 px-3 py-1 rounded text-xs font-medium whitespace-nowrap"
          >
            停止 impersonate
          </button>
        </form>
      </div>
    </div>
  )
}
