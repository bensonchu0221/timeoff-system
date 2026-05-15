"use client"

import { useState, useEffect, useRef } from "react"
import { HelpCircle, X, Search, ChevronRight } from "lucide-react"
import { getFAQs } from "@/app/actions/qa"

export function HelpDrawer() {
  const [isOpen, setIsOpen] = useState(false)
  const [faqs, setFaqs] = useState<any[]>([])
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      loadFAQs()
    }
  }, [isOpen])

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (isOpen) loadFAQs()
    }, 300)

    return () => clearTimeout(delayDebounceFn)
  }, [search])

  async function loadFAQs() {
    setLoading(true)
    try {
      const data = await getFAQs(search)
      setFaqs(data)
    } finally {
      setLoading(false)
    }
  }

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isOpen])

  return (
    <>
      {/* Trigger Button */}
      <button 
        onClick={() => setIsOpen(true)}
        className="p-2 text-white/80 hover:text-white transition-colors"
        title="說明與幫助"
      >
        <HelpCircle className="w-6 h-6" />
      </button>

      {/* Overlay */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity" />
      )}

      {/* Drawer */}
      <div 
        ref={drawerRef}
        className={`fixed top-0 right-0 h-full w-full sm:w-[400px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-900">說明</h2>
            <button onClick={() => setIsOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Search */}
          <div className="p-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                type="text" 
                placeholder="搜尋說明" 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] focus:border-transparent transition text-sm text-gray-900"
              />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 pt-0 space-y-6">
            <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              {search ? '搜尋結果' : '精選說明'}
            </h3>

            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--brand-primary)]"></div>
              </div>
            ) : faqs.length === 0 ? (
              <p className="text-center text-gray-500 py-8 italic">找不到相關說明</p>
            ) : (
              <div className="space-y-4">
                {faqs.map(faq => (
                  <details key={faq.id} className="group border border-gray-100 rounded-xl overflow-hidden hover:border-gray-200 transition">
                    <summary className="flex items-center justify-between p-4 cursor-pointer bg-white group-open:bg-gray-50 transition">
                      <span className="font-medium text-gray-700 text-sm">{faq.question}</span>
                      <ChevronRight className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="p-4 bg-gray-50 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap border-t border-gray-100">
                      {faq.answer}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-6 border-t border-gray-100 bg-gray-50">
            <div className="flex justify-center space-x-4 text-xs text-gray-400">
              <span className="hover:text-gray-600 cursor-pointer">法律聲明</span>
              <span>|</span>
              <span className="hover:text-gray-600 cursor-pointer">隱私權與 Cookie</span>
            </div>
            <p className="text-center text-[10px] text-gray-400 mt-2">
              © 2026 PopIn Timeoff System
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
