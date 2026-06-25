'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useBranch } from '@/context/branch'
import {
  filterSelectableBranches,
  isMainBranchName,
  pickDefaultBranch,
} from '@/lib/branch-constants'

interface Branch {
  id: string
  name: string
}

interface Props {
  userRole: string
  userBranchId?: string
  initialBranchId?: string
  initialBranchName?: string
}

function PinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
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

export default function BranchSelector({ userRole, userBranchId, initialBranchId, initialBranchName }: Props) {
  const isAdmin = userRole === 'admin'
  const router = useRouter()
  const { branchId, branchName, setBranch } = useBranch()

  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [switching, setSwitching] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Load branches list
  useEffect(() => {
    createClient()
      .from('branches')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        const list = filterSelectableBranches(data ?? [])
        setBranches(list)
        const currentIsInvalid =
          !branchId ||
          isMainBranchName(branchName ?? initialBranchName) ||
          isMainBranchName(list.find(b => b.id === branchId)?.name)
        if (isAdmin && currentIsInvalid && list.length > 0) {
          const def = pickDefaultBranch(list)
          if (def) handleSelect(def.id, def.name)
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close on outside click
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

  // Focus search when opened
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  async function handleSelect(id: string, name: string) {
    if (!isAdmin) return
    setSwitching(true)
    try {
      const res = await fetch('/api/admin/set-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: id }),
      })
      if (res.ok) {
        setBranch(id, name)
        setOpen(false)
        setSearch('')
        router.refresh()
      }
    } finally {
      setSwitching(false)
    }
  }

  const activeName = branchName ?? initialBranchName ?? null
  const activeId = branchId ?? initialBranchId ?? null

  const filtered = search.trim()
    ? branches.filter(b => b.name.includes(search.trim()))
    : branches

  // ── Non-admin: premium static badge ──────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#2C8780]/20 bg-gradient-to-l from-[#2C8780]/5 to-transparent">
        <div className="w-6 h-6 rounded-lg bg-[#2C8780]/10 flex items-center justify-center shrink-0">
          <PinIcon className="w-3.5 h-3.5 text-[#2C8780]" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-[9px] font-semibold text-[#2C8780]/70 leading-none uppercase tracking-wide">الفرع</span>
          <span className="text-xs font-bold text-[#231F20] leading-tight truncate max-w-[110px]">
            {activeName ?? '—'}
          </span>
        </div>
      </div>
    )
  }

  // ── Admin: premium interactive dropdown ───────────────────────────────────
  return (
    <div ref={ref} className="relative" dir="rtl">

      {/* ── Trigger button ── */}
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
        {/* Pin icon */}
        <div className={[
          'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200',
          open ? 'bg-white/15' : 'bg-[#2C8780]/8 group-hover:bg-[#2C8780]/12',
        ].join(' ')}>
          <PinIcon className={`w-3.5 h-3.5 ${open ? 'text-white' : 'text-[#2C8780]'}`} />
        </div>

        {/* Label */}
        <div className="flex flex-col items-start min-w-0">
          <span className={`text-[9px] font-bold uppercase tracking-[0.08em] leading-none mb-0.5 ${open ? 'text-white/60' : 'text-[#767676]'}`}>
            الفرع الحالي
          </span>
          <span className="text-xs font-bold leading-none truncate max-w-[110px]">
            {switching ? '...' : (activeName ?? 'اختر فرعاً')}
          </span>
        </div>

        {/* Chevron */}
        <svg
          className={`w-3.5 h-3.5 shrink-0 transition-all duration-200 ${open ? 'rotate-180 text-white/80' : 'text-[#767676] group-hover:text-[#2C8780]'}`}
          fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-[200] w-64 rounded-2xl overflow-hidden"
          style={{
            background: 'white',
            border: '1px solid rgba(118,118,118,0.12)',
            boxShadow: '0 20px 60px -10px rgba(35,31,32,0.18), 0 4px 16px -4px rgba(35,31,32,0.08)',
          }}
        >
          {/* Panel header */}
          <div
            className="px-4 py-3 flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, #2C8780 0%, #1D6365 100%)' }}
          >
            <PinIcon className="w-4 h-4 text-white/80 shrink-0" />
            <div>
              <p className="text-xs font-bold text-white leading-none">اختر الفرع</p>
              <p className="text-[10px] text-white/50 mt-0.5">{branches.length} فرع متاح</p>
            </div>
          </div>

          {/* Search input */}
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
                placeholder="بحث في الفروع..."
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

          {/* Branches list */}
          <div className="max-h-60 overflow-y-auto overscroll-contain py-1" style={{ scrollbarWidth: 'none' }}>
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6">
                <svg className="w-8 h-8 text-[rgba(118,118,118,0.3)]" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <p className="text-xs text-[#767676]">لا توجد نتائج</p>
              </div>
            ) : (
              filtered.map((branch) => {
                const isActive = branch.id === activeId
                return (
                  <button
                    key={branch.id}
                    onClick={() => handleSelect(branch.id, branch.name)}
                    disabled={switching}
                    className={[
                      'w-full flex items-center gap-3 px-4 py-2.5 text-right transition-all duration-150 relative',
                      isActive
                        ? 'bg-gradient-to-l from-[#2C8780]/8 to-[#2C8780]/4'
                        : 'hover:bg-[#F3F1F2] active:bg-[rgba(118,118,118,0.1)]',
                    ].join(' ')}
                  >
                    {/* Active indicator */}
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
                      <PinIcon className={`w-3.5 h-3.5 ${isActive ? 'text-[#2C8780]' : 'text-[#767676]'}`} />
                    </div>

                    <span className={`flex-1 text-sm leading-none ${isActive ? 'font-bold text-[#2C8780]' : 'font-medium text-[#231F20]'}`}>
                      {branch.name}
                    </span>

                    {isActive && (
                      <CheckIcon className="w-4 h-4 text-[#2C8780] shrink-0" />
                    )}
                  </button>
                )
              })
            )}
          </div>

          {/* Footer */}
          <div
            className="px-4 py-2.5 flex items-center justify-between border-t border-[rgba(118,118,118,0.08)]"
            style={{ background: '#F8F7F8' }}
          >
            <span className="text-[10px] text-[#767676]">مدير النظام · كل الفروع</span>
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
