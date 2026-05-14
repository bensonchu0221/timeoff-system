"use client"

import { useState, useEffect, useTransition } from "react"
import { getFAQs, createFAQ, updateFAQ, deleteFAQ } from "@/app/actions/qa"
import { Plus, Trash2, Edit2, Save, X, Search } from "lucide-react"
import toast from "react-hot-toast"

export default function QAEditorPage() {
  const [faqs, setFaqs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  
  // Form states
  const [newFaq, setNewFaq] = useState({ question: "", answer: "", category: "", order: 0 })
  const [editFaq, setEditFaq] = useState({ question: "", answer: "", category: "", order: 0 })

  useEffect(() => {
    loadFAQs()
  }, [])

  async function loadFAQs() {
    setLoading(true)
    try {
      const data = await getFAQs()
      setFaqs(data)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFaq.question || !newFaq.answer) return
    
    startTransition(async () => {
      try {
        await createFAQ(newFaq)
        setNewFaq({ question: "", answer: "", category: "", order: 0 })
        toast.success("已新增 QA")
        loadFAQs()
      } catch (err: any) {
        toast.error(err.message)
      }
    })
  }

  const handleUpdate = async (id: string) => {
    startTransition(async () => {
      try {
        await updateFAQ(id, editFaq)
        setEditingId(null)
        toast.success("已更新 QA")
        loadFAQs()
      } catch (err: any) {
        toast.error(err.message)
      }
    })
  }

  const handleDelete = async (id: string) => {
    if (!confirm("確定要刪除此筆 QA 嗎？")) return
    
    startTransition(async () => {
      try {
        await deleteFAQ(id)
        toast.success("已刪除")
        loadFAQs()
      } catch (err: any) {
        toast.error(err.message)
      }
    })
  }

  const startEditing = (faq: any) => {
    setEditingId(faq.id)
    setEditFaq({ question: faq.question, answer: faq.answer, category: faq.category || "", order: faq.order || 0 })
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">說明與 QA 編輯</h1>
      </div>

      {/* Create New Form */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
          <Plus className="w-5 h-5 text-[var(--brand-primary)]" />
          新增常見問題
        </h2>
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">問題 (Question)</label>
              <input 
                type="text" 
                value={newFaq.question}
                onChange={e => setNewFaq({...newFaq, question: e.target.value})}
                className="w-full px-4 py-2 border border-gray-200 rounded-md focus:ring-2 focus:ring-[var(--brand-primary)] outline-none"
                placeholder="例如：請假幾天要事先知會主管？"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">回答 (Answer)</label>
              <textarea 
                rows={3}
                value={newFaq.answer}
                onChange={e => setNewFaq({...newFaq, answer: e.target.value})}
                className="w-full px-4 py-2 border border-gray-200 rounded-md focus:ring-2 focus:ring-[var(--brand-primary)] outline-none"
                placeholder="例如：超過 3 天（含）的年假都要先知會主管。"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">排序 (越小越前面)</label>
              <input 
                type="number" 
                value={newFaq.order}
                onChange={e => setNewFaq({...newFaq, order: parseInt(e.target.value)})}
                className="w-full px-4 py-2 border border-gray-200 rounded-md focus:ring-2 focus:ring-[var(--brand-primary)] outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">分類 (選填)</label>
              <input 
                type="text" 
                value={newFaq.category}
                onChange={e => setNewFaq({...newFaq, category: e.target.value})}
                className="w-full px-4 py-2 border border-gray-200 rounded-md focus:ring-2 focus:ring-[var(--brand-primary)] outline-none"
                placeholder="例如：請假規則"
              />
            </div>
          </div>
          <button 
            type="submit" 
            disabled={isPending || !newFaq.question || !newFaq.answer}
            className="px-6 py-2 bg-[var(--brand-primary)] text-white rounded-md hover:bg-[var(--brand-primary-dark)] transition disabled:bg-gray-300"
          >
            {isPending ? "處理中..." : "確認新增"}
          </button>
        </form>
      </div>

      {/* List */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-700">現有 QA 列表</h2>
        {loading ? (
          <div className="text-center py-12 text-gray-500">載入中...</div>
        ) : faqs.length === 0 ? (
          <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">目前沒有內容</div>
        ) : (
          <div className="grid gap-4">
            {faqs.map(faq => (
              <div key={faq.id} className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                {editingId === faq.id ? (
                  <div className="space-y-4">
                    <input 
                      type="text" 
                      value={editFaq.question}
                      onChange={e => setEditFaq({...editFaq, question: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-200 rounded-md outline-none"
                    />
                    <textarea 
                      rows={3}
                      value={editFaq.answer}
                      onChange={e => setEditFaq({...editFaq, answer: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-200 rounded-md outline-none"
                    />
                    <div className="flex gap-4">
                      <input 
                        type="number" 
                        value={editFaq.order}
                        onChange={e => setEditFaq({...editFaq, order: parseInt(e.target.value)})}
                        className="w-24 px-4 py-2 border border-gray-200 rounded-md outline-none"
                      />
                      <div className="flex-1 flex justify-end gap-2">
                        <button onClick={() => setEditingId(null)} className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-md transition">取消</button>
                        <button onClick={() => handleUpdate(faq.id)} className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition flex items-center gap-2">
                          <Save className="w-4 h-4" /> 儲存
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-[10px] font-bold rounded uppercase">#{faq.order}</span>
                        <h3 className="font-bold text-gray-800">{faq.question}</h3>
                      </div>
                      <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{faq.answer}</p>
                      {faq.category && (
                        <span className="inline-block px-2 py-1 bg-blue-50 text-blue-600 text-[10px] font-medium rounded">{faq.category}</span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEditing(faq)} className="p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(faq.id)} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
