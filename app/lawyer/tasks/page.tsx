'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { TaskStatus } from '@/lib/types'
import {
  fetchLawyerAssignedTasksPaginated,
  fetchLawyerTaskStatusCounts,
  LAWYER_TASK_PAGE_SIZE,
} from '@/lib/task-assignment'
import LawyerWalletSummary from '@/components/LawyerWalletSummary'
import LawyerTasksGrid from '@/components/LawyerTasksGrid'
import { DEBTOR_SEARCH_PLACEHOLDER, resolveDebtorIdsBySearch } from '@/lib/debtor-search'

const FILTERS: { key: TaskStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'assignment_pending_acceptance', label: 'طلبات تكليف' },
  { key: 'assigned', label: 'مكلفة' },
  { key: 'in_progress', label: 'قيد التنفيذ' },
  { key: 'submitted', label: 'بانتظار الاعتماد' },
  { key: 'rejected', label: 'مرفوضة' },
  { key: 'completed', label: 'منجزة' },
]

export default function LawyerTasksPage() {
  const searchParams = useSearchParams()
  const rawFilter = searchParams.get('f') as TaskStatus | 'all' | null
  const initialFilter = rawFilter === 'approved' ? 'completed' : rawFilter

  const [tasks, setTasks] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [pageOffset, setPageOffset] = useState(0)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({ all: 0 })
  const [walletBalances, setWalletBalances] = useState({ fees: 0, savings: 0 })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState<TaskStatus | 'all'>(
    FILTERS.some(f => f.key === initialFilter) ? (initialFilter as TaskStatus | 'all') : 'all'
  )
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [lawyerId, setLawyerId] = useState<string | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const loadPage = useCallback(async (append = false, offset = 0, userId?: string) => {
    const uid = userId ?? lawyerId
    if (!uid) return

    if (append) setLoadingMore(true)
    else setLoading(true)

    const supabase = createClient()
    const debtorIds = debouncedSearch.trim()
      ? await resolveDebtorIdsBySearch(supabase, debouncedSearch)
      : null

    if (debtorIds && !debtorIds.length) {
      setTasks([])
      setTotal(0)
      setPageOffset(0)
      setLoading(false)
      setLoadingMore(false)
      return
    }

    const page = await fetchLawyerAssignedTasksPaginated(supabase, uid, {
      offset,
      limit: LAWYER_TASK_PAGE_SIZE,
      status: filter,
      debtorIds,
    })

    if (page.error) {
      setLoading(false)
      setLoadingMore(false)
      return
    }

    setTasks(prev => (append ? [...prev, ...page.tasks] : page.tasks))
    setTotal(page.total)
    setPageOffset(offset + page.tasks.length)
    setLoading(false)
    setLoadingMore(false)
  }, [lawyerId, filter, debouncedSearch])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setLawyerId(user.id)

      const [walletRes, counts] = await Promise.all([
        fetch('/api/lawyer/wallet').then(r => r.json()).catch(() => null),
        fetchLawyerTaskStatusCounts(supabase, user.id),
      ])

      setStatusCounts({
        all: counts.all,
        assignment_pending_acceptance: counts.assignment_pending_acceptance,
        assigned: counts.assigned,
        in_progress: counts.in_progress,
        submitted: counts.submitted,
        rejected: counts.rejected,
        completed: counts.completed,
      })

      if (walletRes?.balances) {
        setWalletBalances(walletRes.balances)
      }

      await loadPage(false, 0, user.id)
    })
  }, [])

  useEffect(() => {
    if (!lawyerId) return
    setPageOffset(0)
    loadPage(false, 0)
  }, [filter, debouncedSearch, lawyerId, loadPage])

  const counts = statusCounts
  const hasMore = tasks.length < total

  return (
    <div className="max-w-2xl mx-auto pb-20">

      <div className="px-4 pt-4 pb-3 bg-white border-b border-slate-100 sticky top-0 z-30">
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={DEBTOR_SEARCH_PLACEHOLDER}
            className="w-full bg-[#F3F1F2] border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780]"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </span>
        </div>
      </div>

      <div className="overflow-x-auto bg-white border-b border-slate-100">
        <div className="flex gap-1.5 px-4 py-2.5 min-w-max">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={filter === f.key ? { background: 'linear-gradient(135deg,#2C8780,#1D6365)' } : undefined}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${filter === f.key ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {f.label}
              {counts[f.key] != null && <span className="mr-1 opacity-75">({counts[f.key]})</span>}
            </button>
          ))}
        </div>
      </div>

      {!loading && tasks.length > 0 && (
        <div className="px-4 pt-3">
          <LawyerWalletSummary
            feeBalance={walletBalances.fees}
            savingsBalance={walletBalances.savings}
            compact
          />
          <div className="mt-3 bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm">
            <p className="text-[10px] text-slate-400 font-medium mb-0.5">المهام المعروضة</p>
            <p className="font-black text-slate-800 text-sm tabular-nums">{tasks.length} من {total}</p>
          </div>
        </div>
      )}

      <LawyerTasksGrid
        tasks={tasks}
        loading={loading}
        loadingMore={loadingMore}
        hasMore={hasMore}
        total={total}
        onLoadMore={() => loadPage(true, pageOffset)}
        emptyMessage={search ? `لا نتائج للبحث عن "${search}"` : filter === 'all' ? 'لا توجد مهام' : 'لا توجد مهام بهذه الحالة'}
      />
    </div>
  )
}
