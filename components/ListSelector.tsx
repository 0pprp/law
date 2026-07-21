'use client'

import { useState, useEffect, useRef } from 'react'
import { useBranch } from '@/context/branch'
import { useBranchLists } from '@/hooks/use-branch-lists'
import { refreshAdminNotifications } from '@/lib/admin-notifications'

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h14" />
    </svg>
  )
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

/**
 * فلتر القائمة العلوي — بجانب فلتر الفرع وبنفس تصميمه.
 * يظهر فقط عند اختيار فرع محدد (القوائم مرتبطة بالفرع).
 */
export default function ListSelector() {
  const { branchId, viewAllBranches, listId, listName, setList, clearList } = useBranch()
  const { lists, loading } = useBranchLists(viewAllBranches ? null : branchId)

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [switching, setSwitching] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // إذا صارت القائمة المختارة غير موجودة في الفرع الحالي → الكل
  useEffect(() => {
    if (!branchId || viewAllBranches) {
      if (listId) clearList()
      return
    }
    if (!listId || loading) return
    const stillValid = lists.some(l => l.id === listId)
    if (!stillValid) {
      void persistClear()
    }
  }, [branchId, viewAllBranches, listId, lists, loading])

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  async function persistClear() {
    setSwitching(true)
    try {
      const res = await fetch('/api/admin/set-branch-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      })
      if (res.ok) {
        clearList()
        refreshAdminNotifications()
      }
    } finally {
      setSwitching(false)
    }
  }

  async function handleSelectAll() {
    setSwitching(true)
    try {
      const res = await fetch('/api/admin/set-branch-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
      })
      if (res.ok) {
        clearList()
        refreshAdminNotifications()
        setOpen(false)
        setSearch('')
      }
    } finally {
      setSwitching(false)
    }
  }

  async function handleSelect(id: string, name: string) {
    setSwitching(true)
    try {
      const res = await fetch('/api/admin/set-branch-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listId: id }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        if (json.listId && json.listName) {
          setList(json.listId, json.listName)
        } else {
          clearList()
        }
        refreshAdminNotifications()
        setOpen(false)
        setSearch('')
      }
    } finally {
      setSwitching(false)
    }
  }

  // بدون فرع محدد لا معنى لفلتر القائمة
  if (!branchId || viewAllBranches) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[rgba(118,118,118,0.15)] bg-[#F8F7F8] opacity-70">
        <div className="w-6 h-6 rounded-lg bg-[rgba(118,118,118,0.08)] flex items-center justify-center shrink-0">
          <ListIcon className="w-3.5 h-3.5 text-[#767676]" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[9px] font-semibold text-[#767676] leading-none uppercase tracking-wide">القائمة</span>
          <span className="text-xs font-bold text-[#767676] leading-snug truncate max-w-[110px]">الكل</span>
        </div>
      </div>
    )
  }

  const activeName = listId ? (listName ?? lists.find(l => l.id === listId)?.name ?? 'قائمة') : 'الكل'
  const filtered = search.trim()
    ? lists.filter(l => l.name.includes(search.trim()))
    : lists

  return (
    <div ref={ref} className="relative" dir="rtl">
      <button
        onClick={() => !switching && setOpen(v => !v)}
        disabled={switching}
        className={[
          'group flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all duration-200 select-none',
          open
            ? 'bg-[#2C8780] border-[#1D6365] shadow-lg shadow-[#2C8780]/30 text-white'
            : 'bg-white border-[rgba(118,118,118,0.18)] text-[#231F20] hover:border-[#2C8780]/40 hover:shadow-sm hover:shadow-[#2C8780]/10',
        ].join(' ')}
      >
        <div className={[
          'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200',
          open ? 'bg-white/15' : 'bg-[#2C8780]/8 group-hover:bg-[#2C8780]/12',
        ].join(' ')}>
          <ListIcon className={`w-3.5 h-3.5 ${open ? 'text-white' : 'text-[#2C8780]'}`} />
        </div>

        <div className="flex flex-col items-start min-w-0">
          <span className={`text-[9px] font-bold uppercase tracking-[0.08em] leading-none mb-0.5 ${open ? 'text-white/60' : 'text-[#767676]'}`}>
            القائمة
          </span>
          <span className="text-xs font-bold leading-snug truncate max-w-[110px]">
            {switching ? '...' : activeName}
          </span>
        </div>

        <svg
          className={`w-3.5 h-3.5 shrink-0 transition-all duration-200 ${open ? 'rotate-180 text-white/80' : 'text-[#767676] group-hover:text-[#2C8780]'}`}
          fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-[200] w-64 rounded-2xl overflow-hidden"
          style={{
            background: 'white',
            border: '1px solid rgba(118,118,118,0.12)',
            boxShadow: '0 20px 60px -10px rgba(35,31,32,0.18), 0 4px 16px -4px rgba(35,31,32,0.08)',
          }}
        >
          <div
            className="px-4 py-3 flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, #2C8780 0%, #1D6365 100%)' }}
          >
            <ListIcon className="w-4 h-4 text-white/80 shrink-0" />
            <div>
              <p className="text-xs font-bold text-white leading-none">اختر القائمة</p>
              <p className="text-[10px] text-white/50 mt-0.5">
                {loading ? 'جارٍ التحميل...' : `${lists.length} قائمة + الكل`}
              </p>
            </div>
          </div>

          <div className="p-3 border-b border-[rgba(118,118,118,0.08)]">
            <div className="relative">
              <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#767676] pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="بحث في القوائم..."
                className="w-full pr-9 pl-3 py-2 text-xs rounded-xl border-0 focus:outline-none focus:ring-2 focus:ring-[#2C8780]/20 placeholder:text-[#767676] font-medium"
                style={{ background: '#F3F1F2' }}
                dir="rtl"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#767676] hover:text-[#231F20] transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto overscroll-contain py-1" style={{ scrollbarWidth: 'none' }}>
            {!search.trim() && (
              <button
                onClick={() => void handleSelectAll()}
                disabled={switching}
                className={[
                  'w-full flex items-center gap-3 px-4 py-2.5 text-right transition-all duration-150 relative',
                  !listId
                    ? 'bg-gradient-to-l from-[#2C8780]/8 to-[#2C8780]/4'
                    : 'hover:bg-[#F3F1F2] active:bg-[rgba(118,118,118,0.1)]',
                ].join(' ')}
              >
                {!listId && (
                  <div
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-l"
                    style={{ background: 'linear-gradient(180deg, #2C8780, #1D6365)' }}
                  />
                )}
                <div className={[
                  'w-7 h-7 rounded-xl flex items-center justify-center shrink-0',
                  !listId ? 'bg-[#2C8780]/12' : 'bg-[rgba(118,118,118,0.06)]',
                ].join(' ')}>
                  <svg className={`w-3.5 h-3.5 ${!listId ? 'text-[#2C8780]' : 'text-[#767676]'}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </div>
                <span className={`flex-1 text-sm leading-snug py-0.5 ${!listId ? 'font-bold text-[#2C8780]' : 'font-medium text-[#231F20]'}`}>
                  الكل
                </span>
                {!listId && <CheckIcon className="w-4 h-4 text-[#2C8780] shrink-0" />}
              </button>
            )}

            {loading ? (
              <div className="px-4 py-6 text-center text-xs text-[#767676]">جارٍ التحميل...</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6">
                <svg className="w-8 h-8 text-[rgba(118,118,118,0.3)]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="text-xs text-[#767676]">
                  {lists.length === 0 ? 'لا توجد قوائم في هذا الفرع' : 'لا توجد نتائج'}
                </p>
              </div>
            ) : (
              filtered.map(list => {
                const isActive = list.id === listId
                return (
                  <button
                    key={list.id}
                    onClick={() => void handleSelect(list.id, list.name)}
                    disabled={switching}
                    className={[
                      'w-full flex items-center gap-3 px-4 py-2.5 text-right transition-all duration-150 relative',
                      isActive
                        ? 'bg-gradient-to-l from-[#2C8780]/8 to-[#2C8780]/4'
                        : 'hover:bg-[#F3F1F2] active:bg-[rgba(118,118,118,0.1)]',
                    ].join(' ')}
                  >
                    {isActive && (
                      <div
                        className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-l"
                        style={{ background: 'linear-gradient(180deg, #2C8780, #1D6365)' }}
                      />
                    )}
                    <div className={[
                      'w-7 h-7 rounded-xl flex items-center justify-center shrink-0 transition-all',
                      isActive ? 'bg-[#2C8780]/12' : 'bg-[rgba(118,118,118,0.06)]',
                    ].join(' ')}>
                      <ListIcon className={`w-3.5 h-3.5 ${isActive ? 'text-[#2C8780]' : 'text-[#767676]'}`} />
                    </div>
                    <span className={`flex-1 min-w-0 text-sm leading-snug py-0.5 truncate ${isActive ? 'font-bold text-[#2C8780]' : 'font-medium text-[#231F20]'}`}>
                      {list.name}
                    </span>
                    {isActive && <CheckIcon className="w-4 h-4 text-[#2C8780] shrink-0" />}
                  </button>
                )
              })
            )}
          </div>

          <div
            className="px-4 py-2.5 flex items-center justify-between border-t border-[rgba(118,118,118,0.08)]"
            style={{ background: '#F8F7F8' }}
          >
            <span className="text-[10px] text-[#767676]">مرتبطة بالفرع الحالي</span>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[#2C8780] animate-pulse" />
              <span className="text-[10px] text-[#2C8780] font-semibold">نشط</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
