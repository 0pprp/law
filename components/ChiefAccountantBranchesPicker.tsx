'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchSelectableBranches, type BranchOption } from '@/lib/branches-cache'

/** اختيار متعدد لفروع المحاسب الرئيسي */
export default function ChiefAccountantBranchesPicker({
  selectedIds,
  onChange,
  disabled = false,
}: {
  selectedIds: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
}) {
  const [branches, setBranches] = useState<BranchOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      setLoading(true)
      try {
        const list = await fetchSelectableBranches(createClient())
        setBranches(list)
        setError('')
      } catch {
        setError('فشل تحميل الفروع')
        setBranches([])
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  function toggle(id: string) {
    if (disabled) return
    if (selectedIds.includes(id)) onChange(selectedIds.filter(x => x !== id))
    else onChange([...selectedIds, id])
  }

  function selectAll() {
    if (disabled) return
    onChange(branches.map(b => b.id))
  }

  function clearAll() {
    if (disabled) return
    onChange([])
  }

  if (loading) {
    return <div className="h-28 rounded-xl border border-slate-200 bg-slate-50 animate-pulse" />
  }

  if (error) {
    return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>
  }

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <p className="text-xs font-semibold text-slate-600">
          محدَّد: {selectedIds.length} من {branches.length}
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={disabled} onClick={selectAll} className="text-[11px] font-bold text-[#2C8780] disabled:opacity-50">
            تحديد الكل
          </button>
          <button type="button" disabled={disabled} onClick={clearAll} className="text-[11px] font-bold text-slate-500 disabled:opacity-50">
            مسح
          </button>
        </div>
      </div>
      <div className="max-h-56 overflow-y-auto p-2 space-y-0.5">
        {branches.map(b => {
          const checked = selectedIds.includes(b.id)
          return (
            <label
              key={b.id}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${checked ? 'bg-[#2C8780]/8' : 'hover:bg-slate-50'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(b.id)}
                className="w-4 h-4 accent-[#2C8780]"
              />
              <span className="text-sm font-medium text-slate-800">{b.name}</span>
            </label>
          )
        })}
        {branches.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">لا فروع متاحة</p>
        )}
      </div>
    </div>
  )
}
