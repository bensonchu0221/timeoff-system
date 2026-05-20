"use client"

type Balance = {
  type: string
  total: number
  used: number
  remaining: number
}

// 特休改週年制累計後，「年度」概念對特休不再適用；標題改為「假別額度（截至今日）」
export function BalanceSummary({ balances }: { balances: Balance[] }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-gray-900 mb-4">假別額度（截至今日）</h2>

      {/* 手機版：daisyUI stat 卡片 2 欄 grid */}
      <div className="grid grid-cols-2 gap-3 lg:hidden">
        {balances.map(b => (
          <div key={b.type} className="stat bg-white rounded-lg shadow border border-gray-100 p-3">
            <div className="stat-title text-xs text-gray-500 truncate">{b.type}</div>
            <div className="stat-value text-2xl font-bold text-gray-900">{b.remaining}</div>
            <div className="stat-desc text-gray-400">/ {b.total} 天</div>
          </div>
        ))}
      </div>

      {/* 桌機版：進度條列表 */}
      <div className="hidden lg:block bg-white rounded-lg shadow border border-gray-100 overflow-hidden divide-y divide-gray-100">
        {balances.map(b => {
          const percentage = b.total > 0 ? (b.remaining / b.total) * 100 : 0
          return (
            <div key={b.type} className="p-4">
              <div className="flex justify-between items-center mb-1">
                <span className="font-medium text-gray-700 text-sm">{b.type}</span>
                <div className="text-right text-sm">
                  <span className="font-bold text-gray-900">{b.remaining}</span>
                  <span className="text-gray-400 ml-1">/ {b.total} 天</span>
                </div>
              </div>
              <div className="w-full bg-[#E5E7E5] rounded-full h-1.5 mt-2">
                <div
                  className="bg-[#7A9A8A] h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
