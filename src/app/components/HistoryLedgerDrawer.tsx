"use client"

import { useState, useEffect, useRef } from "react"
import { formatTaipeiDate } from "@/lib/date-format"
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
  const [hireDate, setHireDate] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  
  // Use a ref to scroll to the bottom of the timeline
  const timelineEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen && activeTypeId) {
      setIsLoading(true)
      fetchUserLeaveLedger(activeTypeId).then(res => {
        if (res.success && res.data) {
          setLedger(res.data)
          setHireDate(res.hireDate ? new Date(res.hireDate) : null)
        } else {
          setLedger([])
          setHireDate(null)
        }
        setIsLoading(false)
      })
    }
  }, [isOpen, activeTypeId])

  useEffect(() => {
    if (isOpen && !isLoading && ledger.length > 0) {
      setTimeout(() => {
        timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 100)
    }
  }, [isOpen, isLoading, ledger])

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="text-sm font-medium text-[var(--brand-primary)] hover:text-[var(--brand-primary-dark)] underline transition flex items-center gap-1"
      >
        <CalendarDays className="w-4 h-4" />
        歷史假單
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
            歷史假單
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
              <span className="loading loading-spinner text-[var(--brand-primary)]"></span>
            </div>
          ) : ledger.length === 0 ? (
            <div className="text-center text-gray-500 mt-10">尚無任何歷史紀錄。</div>
          ) : (
            <ul className="timeline timeline-vertical">
              {/* Start element */}
              <li>
                <div className="timeline-start text-xs font-bold text-gray-400 mb-2">今日</div>
                <div className="timeline-middle">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-gray-300"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
                </div>
                <hr className="bg-gray-200" />
              </li>

              {ledger.map((event, idx) => {
                const isGrant = event.type === 'GRANT'
                return (
                  <li key={event.id}>
                    <hr className="bg-gray-200" />
                    
                    {isGrant ? (
                      // Grant items on the left side
                      <div className="timeline-start mb-6">
                        <div className="bg-white border border-[#7A9A8A]/30 p-3 rounded-lg shadow-sm w-48 relative overflow-hidden">
                          <div className="absolute top-0 left-0 w-1 h-full bg-[#7A9A8A]"></div>
                          <div className="text-[10px] font-bold text-gray-400 mb-1">
                            {formatTaipeiDate(event.date)}
                          </div>
                          <div className="font-bold text-[#7A9A8A] flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" /> +{event.amount} 天
                          </div>
                          <div className="text-xs text-gray-600 mt-1 whitespace-pre-line">{event.description}</div>
                          <div className="text-right text-[10px] text-gray-500 mt-2 pt-1 border-t border-gray-100">
                            結餘: <span className="font-bold text-gray-900">{event.runningBalance}</span> 天
                          </div>
                        </div>
                      </div>
                    ) : (
                      // Usage items on the right side
                      <div className="timeline-end mb-6">
                        <div className="bg-white border border-[#C48F8B]/30 p-3 rounded-lg shadow-sm w-48 relative overflow-hidden">
                          <div className="absolute top-0 right-0 w-1 h-full bg-[#C48F8B]"></div>
                          <div className="text-[10px] font-bold text-gray-400 mb-1 text-right">
                            {formatTaipeiDate(event.date)}
                          </div>
                          <div className="font-bold text-[#C48F8B] flex items-center justify-end gap-1">
                            <TrendingDown className="w-3 h-3" /> {event.amount} 天
                          </div>
                          <div className="text-xs text-gray-600 mt-1 text-right whitespace-pre-line">{event.description}</div>
                          <div className="text-left text-[10px] text-gray-500 mt-2 pt-1 border-t border-gray-100">
                            結餘: <span className="font-bold text-gray-900">{event.runningBalance}</span> 天
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div className="timeline-middle">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-5 h-5 ${isGrant ? 'text-[#7A9A8A]' : 'text-[#C48F8B]'}`}><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
                    </div>
                    <hr className="bg-gray-200" />
                  </li>
                )
              })}

              {/* End element */}
              <li>
                <hr className="bg-gray-200" />
                <div className="timeline-middle">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-gray-300"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" /></svg>
                </div>
                <div className="timeline-end text-xs font-bold text-gray-400 mt-2">系統建檔 / 到職日 {hireDate ? `(${formatTaipeiDate(hireDate)})` : ''}</div>
              </li>
            </ul>
          )}
          {/* Invisible element to scroll to */}
          <div ref={timelineEndRef} className="h-4"></div>
        </div>
      </div>
    </>
  )
}
