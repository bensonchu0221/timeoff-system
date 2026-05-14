"use client"

import { useState, useEffect } from "react"
import { X, CalendarDays, TrendingUp, TrendingDown } from "lucide-react"
import { fetchUserLeaveLedger } from "@/app/actions/ledger"
import { LedgerEvent } from "@/lib/ledger-utils"

type LeaveTypeMinimal = { id: string, name: string }

export function HistoryLedgerDrawer({ leaveTypes }: { leaveTypes: LeaveTypeMinimal[] }) {
  const [isOpen, setIsOpen] = useState(false)
  
  // Default to Annual Leave if available, else first one
  const annualLeave = leaveTypes.find(lt => lt.name.includes("特休") || lt.name.toLowerCase().includes("annual"))
  const [activeTypeId, setActiveTypeId] = useState<string>(annualLeave?.id || leaveTypes[0]?.id || "")
  
  const [ledger, setLedger] = useState<LedgerEvent[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (isOpen && activeTypeId) {
      setIsLoading(true)
      fetchUserLeaveLedger(activeTypeId).then(res => {
        if (res.success && res.data) setLedger(res.data)
        else setLedger([])
        setIsLoading(false)
      })
    }
  }, [isOpen, activeTypeId])

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="text-sm font-medium text-[var(--brand-primary)] hover:text-[var(--brand-primary-dark)] underline transition flex items-center gap-1"
      >
        <CalendarDays className="w-4 h-4" />
        歷史紀錄 (存摺)
      </button>

      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-40 transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Drawer */}
      <div 
        className={`fixed top-0 right-0 h-full w-full sm:w-[480px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-[var(--brand-primary)]" />
            個人歷史假表存摺
          </h2>
          <button 
            onClick={() => setIsOpen(false)}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-full transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto border-b border-gray-200 px-4 bg-white shrink-0">
          {leaveTypes.map(lt => (
            <button
              key={lt.id}
              onClick={() => setActiveTypeId(lt.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTypeId === lt.id 
                  ? 'border-[var(--brand-primary)] text-[var(--brand-primary)]' 
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {lt.name}
            </button>
          ))}
        </div>

        {/* Content (Timeline) */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
          {isLoading ? (
            <div className="flex justify-center items-center h-40">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand-primary)]"></div>
            </div>
          ) : ledger.length === 0 ? (
            <div className="text-center text-gray-500 mt-10">尚無任何歷史紀錄。</div>
          ) : (
            <div className="relative border-l-2 border-gray-200 ml-4 space-y-6">
              {ledger.map(event => {
                const isGrant = event.type === 'GRANT'
                return (
                  <div key={event.id} className="relative pl-6">
                    {/* Timeline dot */}
                    <div className={`absolute -left-[9px] top-1.5 w-4 h-4 rounded-full border-2 border-white ${isGrant ? 'bg-[#7A9A8A]' : 'bg-[#C48F8B]'}`} />
                    
                    {/* Card */}
                    <div className="bg-white border border-gray-100 p-4 rounded-lg shadow-sm hover:shadow-md transition">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-bold text-gray-400">
                          {new Date(event.date).toLocaleDateString('zh-TW')}
                        </span>
                        <div className={`flex items-center gap-1 font-bold text-base ${isGrant ? 'text-[#7A9A8A]' : 'text-[#C48F8B]'}`}>
                          {isGrant ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                          {isGrant ? '+' : ''}{event.amount} 天
                        </div>
                      </div>
                      
                      <div className="text-sm font-medium text-gray-800 mb-4">
                        {event.description}
                      </div>
                      
                      <div className="flex justify-end items-center pt-3 border-t border-gray-50 text-sm">
                        <span className="text-gray-500 mr-2">結餘：</span>
                        <span className="font-black text-gray-900 text-lg">
                          {event.runningBalance} <span className="text-xs font-normal text-gray-500">天</span>
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
              
              {/* Start dot */}
              <div className="relative pl-6 pt-4">
                <div className="absolute -left-[9px] top-5 w-4 h-4 rounded-full border-2 border-white bg-gray-300" />
                <div className="text-xs font-bold text-gray-400">系統建檔 / 到職日</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
