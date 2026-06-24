'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS, TASK_STATUS_LABELS } from '@/lib/types'
import { fetchLawyerAssignedTasks } from '@/lib/task-assignment'
import { fetchLawyerWalletBalance } from '@/lib/task-approval'
import type { TaskStatus, TaskType } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { fmtMoney, fmtDate } from '@/lib/utils'

// Statuses visible to lawyer (draft is excluded — lawyer never sees unassigned tasks)
const FILTERS: { key: TaskStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'assignment_pending_acceptance', label: 'طلبات تكليف' },
  { key: 'assigned', label: 'مكلفة' },
  { key: 'in_progress', label: 'قيد التنفيذ' },
  { key: 'submitted', label: 'بانتظار الاعتماد' },
  { key: 'approved', label: 'معتمدة' },
  { key: 'rejected', label: 'مرفوضة' },
  { key: 'completed', label: 'منجزة' },
]

const STATUS_BADGE: Partial<Record<TaskStatus, 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  assignment_pending_acceptance: 'warning',
  assigned: 'info',
  in_progress: 'warning',
  submitted: 'purple',
  approved: 'success',
  rejected: 'danger',
  completed: 'success',
  new: 'info',
  failed: 'danger',
  postponed: 'gray',
  needs_info: 'purple',
  closed: 'gray',
}

export default function LawyerTasksPage() {
  const searchParams = useSearchParams()
  const initialFilter = searchParams.get('f') as TaskStatus | 'all' | null

  const [tasks, setTasks] = useState<any[]>([])
  const [walletBalance, setWalletBalance] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<TaskStatus | 'all'>(
    FILTERS.some(f => f.key === initialFilter) ? (initialFilter as TaskStatus | 'all') : 'all'
  )
  const [search, setSearch] = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const [{ tasks: t }, balance] = await Promise.all([
        fetchLawyerAssignedTasks(supabase, user.id),
        fetchLawyerWalletBalance(supabase, user.id),
      ])
      setTasks(t)
      setWalletBalance(balance)
      setLoading(false)
    })
  }, [])

  const today = new Date().toISOString().split('T')[0]

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tasks.length }
    tasks.forEach(t => { c[t.task_status] = (c[t.task_status] ?? 0) + 1 })
    return c
  }, [tasks])

  const filtered = useMemo(() => {
    let list = tasks
    if (filter !== 'all') list = list.filter(t => t.task_status === filter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(t => (t.debtors?.full_name ?? '').toLowerCase().includes(q))
    }
    return list
  }, [tasks, filter, search])

  const feeBalance = walletBalance

  return (
    <div className="max-w-2xl mx-auto pb-20">

      {/* Search — sticky */}
      <div className="px-4 pt-4 pb-3 bg-white border-b border-slate-100 sticky top-0 z-30">
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="بحث باسم المدين..."
            className="w-full bg-[#F3F1F2] border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780]"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </span>
        </div>
      </div>

      {/* Filter chips */}
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

      {/* Stats */}
      {!loading && tasks.length > 0 && (
        <div className="px-4 pt-3 grid grid-cols-2 gap-3">
          <div className="bg-white border border-[#2C8780]/30 rounded-xl px-4 py-2.5 shadow-sm">
            <p className="text-[10px] text-slate-400 font-medium mb-0.5">رصيد الأتعاب</p>
            <p className="font-black text-[#2C8780] text-sm tabular-nums" dir="ltr">{fmtMoney(feeBalance)}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 shadow-sm">
            <p className="text-[10px] text-slate-400 font-medium mb-0.5">المهام المعروضة</p>
            <p className="font-black text-slate-800 text-sm tabular-nums">{filtered.length} من {tasks.length}</p>
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="p-4">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <div className="w-10 h-10 border-2 border-[#2C8780]/30 border-t-[#2C8780] rounded-full animate-spin" />
            <p className="text-sm text-slate-400">جارٍ التحميل...</p>
          </div>
        ) : !filtered.length ? (
          <div className="text-center py-16 space-y-2">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            </div>
            <p className="text-sm text-slate-400 font-medium">
              {search ? `لا نتائج للبحث عن "${search}"` : filter === 'all' ? 'لا توجد مهام' : 'لا توجد مهام بهذه الحالة'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filtered.map((task: any) => {
              const remaining = Number(task.debtors?.remaining_amount ?? 0)
              const isOverdue = task.due_date && task.due_date < today && !['completed', 'closed', 'failed', 'approved'].includes(task.task_status)
              const fee = Number(task.reward_amount ?? 0)
              return (
                <Link key={task.id} href={`/lawyer/tasks/${task.id}`} className="block">
                  <div className={`bg-white rounded-2xl border shadow-sm active:scale-[0.99] transition-all p-4 h-full flex flex-col ${isOverdue ? 'border-red-200' : 'border-slate-200'}`}>
                    <div className="flex items-start gap-2 mb-1.5">
                      <p className="flex-1 font-bold text-slate-800 text-sm leading-snug truncate">{task.debtors?.full_name ?? '—'}</p>
                      <Badge variant={STATUS_BADGE[task.task_status as TaskStatus] ?? 'default'}>
                        {TASK_STATUS_LABELS[task.task_status as TaskStatus] ?? task.task_status}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400 mb-2.5">{TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400 mb-auto">
                      {task.debtors?.governorate && <span>📍 {task.debtors.governorate}</span>}
                      {task.court_name && <span>🏛 {task.court_name}</span>}
                      {task.due_date && (
                        <span className={isOverdue ? 'text-red-500 font-semibold' : ''} dir="ltr">
                          📅 {fmtDate(task.due_date)}
                        </span>
                      )}
                    </div>
                    {(remaining > 0 || fee > 0) && (
                      <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                        {fee > 0 && <span className="text-[11px] font-bold text-[#2C8780] tabular-nums" dir="ltr">أتعاب: {fmtMoney(fee)}</span>}
                        {remaining > 0 && <span className="text-xs font-black text-red-600 tabular-nums" dir="ltr">{fmtMoney(remaining)}</span>}
                      </div>
                    )}
                    <div className="mt-3 text-[11px] font-bold text-[#2C8780] flex items-center gap-0.5">
                      تفاصيل المهمة ←
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}