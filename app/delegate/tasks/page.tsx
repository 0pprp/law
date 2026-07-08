'use client'

import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { TaskStatus } from '@/lib/types'
import {
  fetchLawyerAssignedTasksPaginated,
  fetchLawyerTaskStatusCounts,
  LAWYER_TASK_PAGE_SIZE,
} from '@/lib/task-assignment'
import { resolveTaskLabel } from '@/lib/task-display-label'
import { lawyerTaskStatusLabel, isLawyerAchievedTask } from '@/lib/lawyer-task-display'
import { isTaskOverdue } from '@/lib/local-date'
import { Badge } from '@/components/ui/badge'
import { fmtDate } from '@/lib/utils'
import { DEBTOR_SEARCH_PLACEHOLDER, resolveDebtorIdsBySearch } from '@/lib/debtor-search'
import TaskAcceptanceActions from '@/components/TaskAcceptanceActions'

const FILTERS: { key: TaskStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'assignment_pending_acceptance', label: 'طلبات تكليف' },
  { key: 'assigned', label: 'مكلفة' },
  { key: 'in_progress', label: 'قيد التنفيذ' },
  { key: 'submitted', label: 'بانتظار الاعتماد' },
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
}

export default function DelegateTasksPage() {
  return (
    <Suspense fallback={<div className="py-16 text-center text-sm text-[#767676]">جارٍ التحميل...</div>}>
      <DelegateTasksInner />
    </Suspense>
  )
}

function DelegateTasksInner() {
  const searchParams = useSearchParams()
  const rawFilter = searchParams.get('f') as TaskStatus | 'all' | null
  const initialFilter = rawFilter === 'approved' ? 'completed' : rawFilter

  const [tasks, setTasks] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [pageOffset, setPageOffset] = useState(0)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({ all: 0 })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [filter, setFilter] = useState<TaskStatus | 'all'>(
    FILTERS.some(f => f.key === initialFilter) ? (initialFilter as TaskStatus | 'all') : 'all',
  )
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [delegateId, setDelegateId] = useState<string | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const loadPage = useCallback(async (append = false, offset = 0, userId?: string) => {
    const uid = userId ?? delegateId
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
  }, [delegateId, filter, debouncedSearch])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      setDelegateId(user.id)
      const counts = await fetchLawyerTaskStatusCounts(supabase, user.id)
      setStatusCounts({
        all: counts.all,
        assignment_pending_acceptance: counts.assignment_pending_acceptance,
        assigned: counts.assigned,
        in_progress: counts.in_progress,
        submitted: counts.submitted,
        rejected: counts.rejected,
        completed: counts.completed,
      })
      await loadPage(false, 0, user.id)
    })
  }, [])

  useEffect(() => {
    if (!delegateId) return
    setPageOffset(0)
    loadPage(false, 0)
  }, [filter, debouncedSearch, delegateId, loadPage])

  const counts = statusCounts
  const hasMore = tasks.length < total

  return (
    <div className="max-w-2xl mx-auto pb-20">
      <div className="px-0 pt-2 pb-3 bg-transparent sticky top-0 z-30">
        <div className="relative bg-white rounded-xl border border-slate-200">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={DEBTOR_SEARCH_PLACEHOLDER}
            className="w-full bg-transparent rounded-xl px-4 py-2.5 pr-10 text-sm font-semibold text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-x-auto bg-white border border-slate-100 rounded-xl mb-3">
        <div className="flex gap-1.5 px-3 py-2.5 min-w-max">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={filter === f.key ? { background: 'linear-gradient(135deg,#2C8780,#1D6365)' } : undefined}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${filter === f.key ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-600'}`}
            >
              {f.label}
              {counts[f.key] != null && <span className="mr-1 opacity-75">({counts[f.key]})</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-sm text-[#767676]">جارٍ التحميل...</div>
      ) : tasks.length === 0 ? (
        <div className="bg-white rounded-2xl border p-10 text-center text-sm text-[#767676]">
          {search ? `لا نتائج للبحث عن "${search}"` : 'لا توجد مهام'}
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => {
            const isOverdue = task.due_date && isTaskOverdue(task.due_date)
              && !['completed', 'closed', 'failed', 'approved'].includes(task.task_status)
            const awaiting = task.task_status === 'assignment_pending_acceptance'
            return (
              <div
                key={task.id}
                className={`bg-white rounded-2xl border p-4 ${isOverdue ? 'border-red-200' : 'border-slate-200'}`}
              >
                <Link href={`/delegate/tasks/${task.id}`} className="block">
                  <div className="flex items-start gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[#231F20] text-sm truncate">{task.debtors?.full_name ?? '—'}</p>
                      <p className="text-xs text-[#767676] mt-0.5">
                        {resolveTaskLabel(task.task_type, task.task_label)}
                      </p>
                    </div>
                    <Badge variant={isLawyerAchievedTask(task.task_status) ? 'success' : (STATUS_BADGE[task.task_status as TaskStatus] ?? 'default')}>
                      {lawyerTaskStatusLabel(task.task_status, task, delegateId)}
                    </Badge>
                  </div>
                  {task.due_date && (
                    <p className={`text-[11px] ${isOverdue ? 'text-red-500 font-semibold' : 'text-[#767676]'}`} dir="ltr">
                      📅 {fmtDate(task.due_date)}
                    </p>
                  )}
                </Link>
                {awaiting && (
                  <div className="mt-3">
                    <TaskAcceptanceActions
                      taskId={task.id}
                      taskLabel={resolveTaskLabel(task.task_type, task.task_label)}
                      expiresAt={task.assignment_expires_at}
                    />
                  </div>
                )}
              </div>
            )
          })}
          {hasMore && (
            <button
              type="button"
              onClick={() => loadPage(true, pageOffset)}
              disabled={loadingMore}
              className="w-full py-3 text-sm font-bold text-[#2C8780] bg-white border border-slate-200 rounded-xl"
            >
              {loadingMore ? 'جارٍ التحميل...' : `تحميل المزيد (${tasks.length} من ${total})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
