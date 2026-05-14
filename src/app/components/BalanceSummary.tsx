"use client"

type Balance = {
  type: string
  total: number
  used: number
  remaining: number
}

export function BalanceSummary({ balances, year }: { balances: Balance[], year: number }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium text-gray-900 mb-4">{year} 年假別額度</h2>
      <div className="bg-white rounded-lg shadow border border-gray-100 overflow-hidden divide-y divide-gray-100">
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
                ></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
