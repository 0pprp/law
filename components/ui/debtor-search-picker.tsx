'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  fetchDebtorsBySearch,
  fetchDebtorById,
  DEBTOR_SEARCH_PLACEHOLDER,
  debtorSelectHint,
  type DebtorSearchRow,
} from '@/lib/debtor-search'
import { cn } from '@/lib/utils'

interface DebtorSearchPickerProps {
  value: string
  onChange: (debtorId: string, debtor: DebtorSearchRow | null) => void
  branchId?: string | null
  disabled?: boolean
  /** Supabase select columns — use DEBTOR_TASK_SELECT for task forms */
  select?: string
  className?: string
  allowClear?: boolean
  clearLabel?: string
}

export function DebtorSearchPicker({
  value,
  onChange,
  branchId,
  disabled = false,
  select,
  className,
  allowClear = false,
  clearLabel = 'إلغاء التحديد',
}: DebtorSearchPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DebtorSearchRow[]>([])
  const [selected, setSelected] = useState<DebtorSearchRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!value) {
      setSelected(null)
      return
    }
    if (selected?.id === value) return

    let cancelled = false
    fetchDebtorById(createClient(), value, { branchId, select }).then(row => {
      if (!cancelled && row) setSelected(row)
    })
    return () => { cancelled = true }
  }, [value, branchId, select, selected?.id])

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  const runSearch = useCallback(async (term: string) => {
    if (!term.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const rows = await fetchDebtorsBySearch(createClient(), term, { branchId, select })
    setResults(rows)
    setLoading(false)
    setOpen(true)
  }, [branchId, select])

  function onInputChange(v: string) {
    setQuery(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(v), 300)
  }

  function pick(d: DebtorSearchRow) {
    setSelected(d)
    setQuery('')
    setResults([])
    setOpen(false)
    onChange(d.id, d)
  }

  function clearSelection() {
    setSelected(null)
    setQuery('')
    setResults([])
    setOpen(false)
    onChange('', null)
  }

  const inputClass =
    'w-full rounded-xl border border-[rgba(118,118,118,0.18)] bg-[#FAFAFA] px-3.5 py-2.5 pr-10 text-sm text-[#231F20] font-medium placeholder:text-[#767676] placeholder:font-normal transition-all focus:outline-none focus:ring-2 focus:ring-[#2C8780]/20 focus:border-[#2C8780] focus:bg-white disabled:opacity-50'

  return (
    <div ref={wrapRef} className={cn('relative', className)} dir="rtl">
      {selected ? (
        <div className="flex items-start gap-3 p-3.5 rounded-xl border border-[#2C8780]/25 bg-[#2C8780]/5">
          <div className="w-9 h-9 rounded-xl bg-[#2C8780]/15 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-[#2C8780]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-[#231F20] truncate">{selected.full_name}</p>
            {debtorSelectHint(selected) && (
              <p className="text-xs text-[#767676] mt-0.5 truncate">{debtorSelectHint(selected)}</p>
            )}
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs font-bold text-[#2C8780] hover:text-[#1D6365] shrink-0 px-2 py-1 rounded-lg border border-[#2C8780]/30 hover:bg-[#2C8780]/10"
            >
              تغيير
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={e => onInputChange(e.target.value)}
            onFocus={() => { if (results.length) setOpen(true) }}
            disabled={disabled}
            placeholder={DEBTOR_SEARCH_PLACEHOLDER}
            className={inputClass}
            autoComplete="off"
          />
          <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
            {loading ? (
              <svg className="w-4 h-4 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-[#767676]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </div>
        </div>
      )}

      {allowClear && value && (
        <button type="button" onClick={clearSelection} className="mt-2 text-xs text-[#767676] hover:text-[#2C8780] font-semibold">
          {clearLabel}
        </button>
      )}

      {open && !selected && (
        <div
          className="absolute z-[100] left-0 right-0 top-full mt-2 rounded-2xl overflow-hidden max-h-64 overflow-y-auto"
          style={{
            background: 'white',
            border: '1px solid rgba(118,118,118,0.12)',
            boxShadow: '0 20px 60px -10px rgba(35,31,32,0.18), 0 4px 16px -4px rgba(35,31,32,0.08)',
          }}
        >
          {loading && results.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#767676]">جارٍ البحث...</p>
          ) : results.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#767676]">
              {query.trim() ? 'لا توجد نتائج — جرّب اسماً أو هاتفاً أو رقم وصل' : 'اكتب للبحث عن مدين'}
            </p>
          ) : (
            results.map(d => (
              <button
                key={d.id}
                type="button"
                onClick={() => pick(d)}
                className="w-full flex items-center gap-3 px-4 py-3 text-right hover:bg-[#F3F1F2] active:bg-[rgba(118,118,118,0.1)] transition-colors border-b border-[rgba(118,118,118,0.06)] last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-[#231F20] truncate">{d.full_name}</span>
                  {debtorSelectHint(d) && (
                    <span className="block text-[10px] text-[#767676] mt-0.5 truncate">{debtorSelectHint(d)}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
