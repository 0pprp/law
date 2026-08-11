'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { TASK_TYPE_LABELS, assigneePersonLabel } from '@/lib/types'
import type { TaskType } from '@/lib/types'
import { fmtDate } from '@/lib/utils'
import { fetchPendingReviewTasksPaginated, fetchBranchLawyers, REVIEW_TASK_PAGE_SIZE } from '@/lib/task-assignment'
import { fetchBranchDelegates } from '@/lib/branch-profiles'
import { refreshAdminNotifications } from '@/lib/admin-notifications'
import { PageHeader } from '@/components/ui/page-header'
import { useBranch, useBranchId } from '@/context/branch'
import { PremiumSelect } from '@/components/ui/premium-select'
import { useAdminRole } from '@/context/admin-role'
import { canReviewTasks } from '@/lib/permissions'
import { useCaseScope } from '@/hooks/use-case-scope'
import { CASE_TYPE_FILTER_OPTIONS, type CaseType } from '@/lib/case-type'
import { readIncompleteReason } from '@/lib/incomplete-completion'
import { cachePeek, cacheSet, CACHE_TTL } from '@/lib/query-cache'

function IncompleteReviewModal({
  task,
  onClose,
  onDone,
  canReview = true,
}: {
  task: any
  onClose: () => void
  onDone: () => void
  canReview?: boolean
}) {
  const [stage, setStage] = useState<'view' | 'reject'>('view')
  const [rejectReason, setRejectReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const taskLabel = task.task_definitions?.label ?? (TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type)
  const reason = readIncompleteReason(task)

  async function approve() {
    setSaving(true)
    setError('')
    const res = await fetch('/api/admin/approve-incomplete-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: task.id }),
    })
    const result = await res.json().catch(() => ({}))
    if (!res.ok || !result.ok) {
      setError(result.error ?? 'فشل اعتماد الطلب')
      setSaving(false)
      return
    }
    refreshAdminNotifications()
    setSaving(false)
    onDone()
    onClose()
  }

  async function reject() {
    if (!rejectReason.trim()) {
      setError('يجب إدخال سبب الرفض')
      return
    }
    setSaving(true)
    setError('')
    const res = await fetch('/api/admin/reject-incomplete-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: task.id, reason: rejectReason.trim() }),
    })
    const result = await res.json().catch(() => ({}))
    if (!res.ok || !result.ok) {
      setError(result.error ?? 'فشل رفض الطلب')
      setSaving(false)
      return
    }
    refreshAdminNotifications()
    setSaving(false)
    onDone()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.6)', backdropFilter: 'blur(3px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-[#231F20] text-base">{taskLabel}</h2>
            <p className="text-sm text-[#767676] mt-0.5">
              <span className="font-semibold">المدين:</span> {task.debtors?.full_name ?? '—'}
              {' · '}
              <span className="font-semibold">{assigneePersonLabel(task.lawyer?.role)}:</span> {task.lawyer?.full_name ?? '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-xl leading-none hover:bg-slate-200 transition-colors"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <p className="text-xs font-bold text-amber-800 mb-1">طلب إرسال بدون إنجاز</p>
            <p className="text-sm text-amber-900 whitespace-pre-wrap">{reason || '—'}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#F3F1F2] rounded-xl p-3">
              <p className="text-xs text-[#767676] mb-1 font-semibold">تاريخ الطلب</p>
              <p className="text-sm font-bold text-[#231F20]" dir="ltr">
                {task.completed_at ? fmtDate(task.completed_at.split('T')[0]) : '—'}
              </p>
            </div>
            {task.court_name && (
              <div className="bg-[#F3F1F2] rounded-xl p-3">
                <p className="text-xs text-[#767676] mb-1 font-semibold">المحكمة</p>
                <p className="text-sm font-bold text-[#231F20]">{task.courts?.name ?? task.court_name}</p>
              </div>
            )}
          </div>

          {stage === 'view' && canReview && (
            <div className="space-y-2">
              {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}
              <p className="text-[11px] text-[#767676] leading-relaxed">
                الاعتماد يلغي التكليف ويعيد المهمة لبطاقة بانتظار التكليف. الرفض يُبقي المهمة مكلفة ويعرض سبب الرفض للمحامي.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void approve()}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white hover:opacity-90 disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                >
                  {saving ? 'جارٍ الاعتماد...' : '✓ اعتماد — إلغاء التكليف'}
                </button>
                <button
                  type="button"
                  onClick={() => setStage('reject')}
                  disabled={saving}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
                >
                  رفض الطلب
                </button>
              </div>
            </div>
          )}

          {stage === 'reject' && canReview && (
            <div className="space-y-3">
              <label className="block text-xs font-bold text-[#231F20]">سبب الرفض (يظهر للمحامي)</label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] resize-none"
                placeholder="اكتب سبب رفض الطلب..."
              />
              {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setStage('view'); setError('') }}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-[#767676] border border-[rgba(118,118,118,0.2)] hover:bg-slate-50 disabled:opacity-60"
                >
                  رجوع
                </button>
                <button
                  type="button"
                  onClick={() => void reject()}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
                >
                  {saving ? 'جارٍ الرفض...' : 'تأكيد الرفض'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function IncompleteTasksPage() {
  const branchId = useBranchId()
  const { viewAllBranches, listId } = useBranch()
  const role = useAdminRole()
  const canReview = canReviewTasks(role)
  const { caseTypeFilter: lockedCaseType } = useCaseScope()

  const [tasks, setTasks] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [pageOffset, setPageOffset] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<any | null>(null)
  const [filterLawyer, setFilterLawyer] = useState('')
  const [filterDelegate, setFilterDelegate] = useState('')
  const [filterCaseType, setFilterCaseType] = useState<'' | CaseType>(lockedCaseType ?? '')
  const [lawyers, setLawyers] = useState<any[]>([])
  const [delegates, setDelegates] = useState<{ id: string; full_name: string }[]>([])
  const lawyersRef = useRef(lawyers)
  const delegatesRef = useRef(delegates)
  lawyersRef.current = lawyers
  delegatesRef.current = delegates

  const effectiveCaseType = lockedCaseType ?? (filterCaseType || null)
  const assigneeFilterId = filterDelegate || filterLawyer || null

  useEffect(() => {
    setFilterCaseType(lockedCaseType ?? '')
  }, [branchId, viewAllBranches, listId, lockedCaseType])

  const load = useCallback(async (append = false, offset = 0) => {
    const supabase = createClient()

    if (!branchId && !viewAllBranches) {
      setTasks([])
      setLawyers([])
      setDelegates([])
      setTotal(0)
      setLoading(false)
      return
    }

    if (append) setLoadingMore(true)
    else {
      const cacheKey = `tasks:incomplete:v2:${branchId ?? 'all'}:${listId ?? 'all'}:${assigneeFilterId ?? 'all'}:${effectiveCaseType || 'all'}:${offset}`
      const cachedHit = cachePeek<{ tasks: any[]; lawyers: any[]; delegates: any[]; total: number }>(cacheKey)
      if (cachedHit) {
        const cached = cachedHit.value
        setTasks(cached.tasks)
        setLawyers(cached.lawyers)
        setDelegates(cached.delegates ?? [])
        setTotal(cached.total)
        setPageOffset(cached.tasks.length)
        setLoading(false)
        if (cachedHit.fresh) return
      } else {
        setLoading(true)
        setTasks([])
      }
    }

    try {
      const [page, l, dRes] = await Promise.all([
        fetchPendingReviewTasksPaginated(supabase, branchId, {
          offset,
          limit: REVIEW_TASK_PAGE_SIZE,
          lawyerId: assigneeFilterId,
          caseType: effectiveCaseType,
          includeCompletionData: true,
          branchListId: (!viewAllBranches && listId) ? listId : null,
          incompleteOnly: true,
        }),
        append ? Promise.resolve(lawyersRef.current) : fetchBranchLawyers(supabase, branchId, {
          caseType: effectiveCaseType,
        }),
        append
          ? Promise.resolve({ delegates: delegatesRef.current })
          : fetchBranchDelegates(supabase, branchId),
      ])

      const nextTasks = page.tasks
      const nextDelegates = dRes.delegates ?? []

      setTasks(prev => {
        const merged = append ? [...prev, ...nextTasks] : nextTasks
        cacheSet(
          `tasks:incomplete:v2:${branchId ?? 'all'}:${listId ?? 'all'}:${assigneeFilterId ?? 'all'}:${effectiveCaseType || 'all'}:${offset}`,
          {
            tasks: merged,
            lawyers: l ?? [],
            delegates: nextDelegates,
            total: page.total,
          },
          CACHE_TTL.list,
        )
        return merged
      })

      if (!append) {
        setLawyers(l ?? [])
        setDelegates(nextDelegates)
      }
      setTotal(page.total)
      setPageOffset(offset + nextTasks.length)
    } catch (e) {
      console.error('[tasks/incomplete] load error:', e)
      if (!append) {
        setTasks([])
        setTotal(0)
      }
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [branchId, viewAllBranches, listId, assigneeFilterId, effectiveCaseType])

  useEffect(() => {
    void load(false, 0)
  }, [load])

  const hasMore = tasks.length < total

  return (
    <div className="space-y-5">
      <PageHeader
        title="غير منجزة"
        subtitle={`${total} طلب إرسال بدون إنجاز بانتظار القرار`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-60">
          <PremiumSelect
            value={lockedCaseType ?? filterCaseType}
            onChange={(v) => {
              if (lockedCaseType) return
              setFilterCaseType(v === 'civil' || v === 'criminal' ? v : '')
            }}
            options={
              lockedCaseType
                ? CASE_TYPE_FILTER_OPTIONS.filter(o => o.value === lockedCaseType).map(o => ({ value: o.value, label: o.label }))
                : CASE_TYPE_FILTER_OPTIONS.map(o => ({ value: o.value, label: o.label }))
            }
            placeholder="كل أنواع الدعاوى"
            headerTitle="تصفية حسب نوع الدعوى"
            searchable={false}
            disabled={Boolean(lockedCaseType)}
          />
        </div>
        <div className="w-60">
          <PremiumSelect
            value={filterLawyer}
            onChange={(v) => {
              setFilterLawyer(v)
              setFilterDelegate('')
            }}
            options={lawyers.map((l: any) => ({ value: l.id, label: l.full_name }))}
            placeholder="كل المحامين"
            headerTitle="تصفية حسب المحامي"
            searchable
          />
        </div>
        {delegates.length > 0 && (
          <div className="w-60">
            <PremiumSelect
              value={filterDelegate}
              onChange={(v) => {
                setFilterDelegate(v)
                setFilterLawyer('')
              }}
              options={delegates.map(d => ({ value: d.id, label: d.full_name }))}
              placeholder="كل المندوبين"
              headerTitle="تصفية حسب المندوب"
              searchable
            />
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-[#767676] text-sm">جارٍ التحميل...</div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-16 text-[#767676] text-sm">لا توجد طلبات إرسال بدون إنجاز</div>
      ) : (
        <div className="space-y-3">
          {tasks.map(task => {
            const taskLabel = task.task_definitions?.label
              ?? (TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type)
            const reason = readIncompleteReason(task)
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => setReviewing(task)}
                className="w-full text-right bg-white border border-[rgba(118,118,118,0.12)] rounded-2xl px-4 py-3.5 hover:border-[#2C8780]/40 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#231F20] text-sm truncate">{task.debtors?.full_name ?? '—'}</p>
                    <p className="text-xs text-[#767676] mt-0.5 font-semibold">{taskLabel}</p>
                    <p className="text-[11px] text-amber-800 mt-1.5 line-clamp-2">
                      السبب: {reason || '—'}
                    </p>
                    <p className="text-[11px] text-[#767676] mt-1">
                      {assigneePersonLabel(task.lawyer?.role)}: {task.lawyer?.full_name ?? '—'}
                      {task.completed_at ? ` · ${fmtDate(String(task.completed_at).split('T')[0])}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                    بدون إنجاز
                  </span>
                </div>
              </button>
            )
          })}
          {hasMore && (
            <div className="text-center pt-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void load(true, pageOffset)}
                className="text-sm font-bold text-[#2C8780] hover:underline disabled:opacity-50"
              >
                {loadingMore ? 'جارٍ التحميل...' : `تحميل المزيد (${tasks.length} / ${total})`}
              </button>
            </div>
          )}
        </div>
      )}

      {reviewing && (
        <IncompleteReviewModal
          task={reviewing}
          canReview={canReview}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null)
            void load(false, 0)
          }}
        />
      )}
    </div>
  )
}
