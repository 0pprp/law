'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveTaskLabel } from '@/lib/task-display-label'
import type { TaskStatus, TaskType } from '@/lib/types'
import { TASK_TYPE_LABELS } from '@/lib/types'
import { isLawyerAchievedTask, lawyerTaskStatusLabel } from '@/lib/lawyer-task-display'
import { isTaskOverdue } from '@/lib/local-date'
import { Badge } from '@/components/ui/badge'
import { fmtMoney, fmtDate } from '@/lib/utils'
import TaskCompletionExpenseModal from '@/components/TaskCompletionExpenseModal'
import { LawyerTaskCompletionModal } from '@/components/TaskUpdateForm'
import { fetchLawyerTaskExpenses, mergeExpenseSources } from '@/lib/fetch-lawyer-task-expenses'
import {
  getTaskExpenses,
  normalizeExpenseRows,
  taskHasExpenses,
  type TaskDefinitionExpense,
} from '@/lib/task-definition-expenses'
import type { PendingTaskExpense } from '@/lib/persist-task-expenses'

const STATUS_BADGE: Partial<Record<TaskStatus, 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  assignment_pending_acceptance: 'warning',
  assigned: 'info',
  in_progress: 'warning',
  submitted: 'purple',
  approved: 'success',
  rejected: 'danger',
  completed: 'success',
}

const ACCEPT_STATUSES = new Set(['assignment_pending_acceptance'])
const COMPLETE_STATUSES = new Set(['assigned', 'in_progress', 'new', 'rejected', 'needs_info', 'needs_revision'])

function TaskSelectCheckbox({
  checked,
  onToggle,
}: {
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? 'إلغاء تحديد المهمة' : 'تحديد المهمة'}
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        onToggle()
      }}
      className={[
        'w-[22px] h-[22px] rounded-md border-2 flex items-center justify-center shrink-0 transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2C8780]/40 focus-visible:ring-offset-1',
        checked
          ? 'bg-[#2C8780] border-[#2C8780] text-white shadow-sm'
          : 'bg-white border-slate-300 hover:border-[#2C8780]/70 hover:bg-slate-50',
      ].join(' ')}
    >
      {checked && (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.75} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  )
}

function isBatchSelectable(status: string): boolean {
  return ACCEPT_STATUSES.has(status) || COMPLETE_STATUSES.has(status)
}

interface ReqField {
  id: string
  field_key: string
  field_type: string
  field_label: string | null
  is_required: boolean
  sort_order: number
}

interface BatchTaskCtx {
  task: Record<string, unknown>
  expenseDefs: TaskDefinitionExpense[]
  reqFields: ReqField[]
  fee: number
  label: string
}

interface Props {
  tasks: any[]
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  total: number
  onLoadMore: () => void
  emptyMessage?: string
}

export default function LawyerTasksGrid({
  tasks,
  loading,
  loadingMore,
  hasMore,
  total,
  onLoadMore,
  emptyMessage = 'لا توجد مهام',
}: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchReport, setBatchReport] = useState<{ ok: number; fails: { label: string; reason: string }[] } | null>(null)

  const [queue, setQueue] = useState<BatchTaskCtx[]>([])
  const [queueIndex, setQueueIndex] = useState(0)
  const [showExpense, setShowExpense] = useState(false)
  const [showCompletion, setShowCompletion] = useState(false)
  const [batchPendingExpenses, setBatchPendingExpenses] = useState<PendingTaskExpense[]>([])
  const [batchExpenseStepDone, setBatchExpenseStepDone] = useState(false)

  const selectableTasks = tasks.filter(t => isBatchSelectable(t.task_status))
  const selectedCount = [...selected].filter(id => tasks.some(t => t.id === id && isBatchSelectable(t.task_status))).length

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function loadTaskContext(taskRow: any): Promise<BatchTaskCtx | null> {
    const supabase = createClient()
    const { data: task } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskRow.id)
      .single()
    if (!task) return null

    let debtorName: string | null = null
    if (task.debtor_id) {
      const { data: debtor } = await supabase
        .from('debtors')
        .select('full_name')
        .eq('id', task.debtor_id)
        .maybeSingle()
      debtorName = debtor?.full_name ?? null
    }
    const taskWithDebtor = { ...task, debtors: debtorName ? { full_name: debtorName } : null }

    let fee = 0
    let reqFields: ReqField[] = []
    let defLabel: string | null = taskRow.task_label ?? (task as { task_label?: string }).task_label ?? null
    let defType: string | null = task.task_type ?? null

    let expenseDefsFromEmbed: TaskDefinitionExpense[] = []

    if (task.task_definition_id) {
      const { data: def } = await supabase
        .from('task_definitions')
        .select('id, fee_amount, label, task_type, task_required_fields(*), task_definition_expenses(id, task_definition_id, name, max_amount, sort_order)')
        .eq('id', task.task_definition_id)
        .maybeSingle()
      if (def) {
        fee = Number(def.fee_amount ?? 0)
        reqFields = ((def as { task_required_fields?: ReqField[] }).task_required_fields ?? [])
          .sort((a, b) => a.sort_order - b.sort_order)
        defLabel = def.label ?? defLabel
        defType = def.task_type ?? defType
        expenseDefsFromEmbed = normalizeExpenseRows(
          (def as { task_definition_expenses?: unknown }).task_definition_expenses,
        )
      }
    }

    const { expenses: apiExpenses, taskDefinitionId: apiDefId } = await fetchLawyerTaskExpenses(task.id as string)
    const { expenses: localExpenses, taskDefinitionId: localDefId } = await getTaskExpenses(supabase, {
      taskDefinitionId: task.task_definition_id,
      taskName: defLabel ?? taskRow.task_label,
      branchId: task.branch_id,
      taskType: defType ?? task.task_type,
    })

    const expenseDefs = mergeExpenseSources(expenseDefsFromEmbed, apiExpenses, localExpenses)

    console.log('[تم الإنجاز — batch]', {
      taskId: task.id,
      taskName: defLabel ?? taskRow.task_label,
      taskDefinitionId: apiDefId ?? localDefId ?? task.task_definition_id,
      expensesFound: expenseDefs.length,
    })

    const label = resolveTaskLabel(defType ?? task.task_type, defLabel)
    return { task: taskWithDebtor, expenseDefs, reqFields, fee, label }
  }

  const finishQueueItem = useCallback((success: boolean, reason?: string) => {
    setBatchReport(prev => {
      const base = prev ?? { ok: 0, fails: [] as { label: string; reason: string }[] }
      const current = queue[queueIndex]
      if (success) return { ...base, ok: base.ok + 1 }
      return {
        ...base,
        fails: [...base.fails, { label: current?.label ?? 'مهمة', reason: reason ?? 'فشل غير معروف' }],
      }
    })
    setShowExpense(false)
    setShowCompletion(false)
    setBatchPendingExpenses([])
    setBatchExpenseStepDone(false)
    const next = queueIndex + 1
    if (next < queue.length) {
      setQueueIndex(next)
      const nextCtx = queue[next]
      if (nextCtx && taskHasExpenses(nextCtx.expenseDefs)) {
        setShowExpense(true)
      } else setShowCompletion(true)
    } else {
      setQueue([])
      setQueueIndex(0)
      router.refresh()
    }
  }, [queue, queueIndex, router])

  async function runBatch() {
    if (!selectedCount || batchRunning) return
    setBatchRunning(true)
    setBatchReport(null)

    const chosen = tasks.filter(t => selected.has(t.id) && isBatchSelectable(t.task_status))
    const toAccept = chosen.filter(t => ACCEPT_STATUSES.has(t.task_status))
    const toComplete = chosen.filter(t => COMPLETE_STATUSES.has(t.task_status))

    let ok = 0
    const fails: { label: string; reason: string }[] = []

    for (const t of toAccept) {
      const label = resolveTaskLabel(t.task_type, t.task_label)
      try {
        const res = await fetch('/api/lawyer/task-assignment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: t.id, action: 'accept' }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok) ok++
        else fails.push({ label, reason: data.error ?? 'فشل قبول التكليف' })
      } catch {
        fails.push({ label, reason: 'خطأ في الاتصال' })
      }
    }

    if (toComplete.length) {
      const contexts: BatchTaskCtx[] = []
      for (const t of toComplete) {
        const ctx = await loadTaskContext(t)
        if (ctx) contexts.push(ctx)
        else fails.push({ label: resolveTaskLabel(t.task_type, t.task_label), reason: 'تعذر تحميل بيانات المهمة' })
      }
      setBatchReport({ ok, fails })
      if (contexts.length) {
        setQueue(contexts)
        setQueueIndex(0)
        if (contexts[0] && taskHasExpenses(contexts[0].expenseDefs)) {
          setShowExpense(true)
        } else setShowCompletion(true)
      }
    } else {
      setBatchReport({ ok, fails })
      router.refresh()
    }

    setSelected(new Set())
    setBatchRunning(false)
  }

  const activeCtx = queue[queueIndex] ?? null

  return (
    <>
      {selectableTasks.length > 0 && (
        <div className="px-4 pt-3">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 shadow-sm">
            <p className="text-xs text-slate-500">
              {selectedCount > 0 ? `${selectedCount} مهمة محددة` : 'حدّد مهاماً لتنفيذها دفعة واحدة'}
            </p>
            <button
              type="button"
              onClick={runBatch}
              disabled={selectedCount === 0 || batchRunning || queue.length > 0}
              className="px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
            >
              {batchRunning ? 'جارٍ التنفيذ...' : 'تنفيذ المهام المحددة'}
            </button>
          </div>
        </div>
      )}

      {batchReport && !queue.length && (
        <div className="px-4 pt-2">
          <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm space-y-2">
            <p className="font-bold text-slate-800">نتيجة التنفيذ</p>
            {batchReport.ok > 0 && <p className="text-emerald-700">تم تنفيذ {batchReport.ok} مهمة بنجاح</p>}
            {batchReport.fails.length > 0 && (
              <div className="text-red-700 space-y-1">
                <p className="font-semibold">فشل {batchReport.fails.length} مهمة:</p>
                {batchReport.fails.map((f, i) => (
                  <p key={i} className="text-xs">• {f.label}: {f.reason}</p>
                ))}
              </div>
            )}
            <button type="button" onClick={() => setBatchReport(null)} className="text-xs text-[#2C8780] font-bold">إغلاق</button>
          </div>
        </div>
      )}

      <div className="p-4">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <div className="w-10 h-10 border-2 border-[#2C8780]/30 border-t-[#2C8780] rounded-full animate-spin" />
            <p className="text-sm text-slate-400">جارٍ التحميل...</p>
          </div>
        ) : !tasks.length ? (
          <div className="text-center py-16 space-y-2">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            </div>
            <p className="text-sm text-slate-400 font-medium">{emptyMessage}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tasks.map((task: any) => {
                const remaining = Number(task.debtors?.remaining_amount ?? 0)
                const isOverdue = task.due_date && isTaskOverdue(task.due_date) && !['completed', 'closed', 'failed', 'approved'].includes(task.task_status)
                const fee = Number(task.reward_amount ?? 0)
                const selectable = isBatchSelectable(task.task_status)
                return (
                  <div
                    key={task.id}
                    className={`relative bg-white rounded-2xl border shadow-sm h-full flex flex-col overflow-hidden ${
                      isOverdue ? 'border-red-200' : 'border-slate-200'
                    }`}
                  >
                    <div className={`p-4 flex flex-col flex-1 min-h-0 ${selectable ? 'pt-3.5 pr-11' : ''}`}>
                      {selectable && (
                        <div className="absolute top-3.5 right-3.5 z-10">
                          <TaskSelectCheckbox
                            checked={selected.has(task.id)}
                            onToggle={() => toggle(task.id)}
                          />
                        </div>
                      )}
                      <Link href={`/lawyer/tasks/${task.id}`} className="block flex-1 min-w-0">
                        <div className="flex items-start gap-2 mb-1.5">
                          <p className="flex-1 font-bold text-slate-800 text-sm leading-snug truncate min-w-0">
                            {task.debtors?.full_name ?? '—'}
                          </p>
                          <Badge
                            variant={isLawyerAchievedTask(task.task_status) ? 'success' : (STATUS_BADGE[task.task_status as TaskStatus] ?? 'default')}
                            className="shrink-0"
                          >
                            {lawyerTaskStatusLabel(task.task_status)}
                          </Badge>
                        </div>
                      <p className="text-xs text-slate-400 mb-2.5 font-semibold">{resolveTaskLabel(task.task_type, task.task_label)}</p>
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
                    </Link>
                    </div>
                  </div>
                )
              })}
            </div>
            {hasMore && (
              <div className="mt-4 text-center">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="text-sm font-bold text-[#2C8780] hover:underline disabled:opacity-50"
                >
                  {loadingMore ? 'جارٍ التحميل...' : `تحميل المزيد (${tasks.length} / ${total})`}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {activeCtx && showExpense && taskHasExpenses(activeCtx.expenseDefs) && (
        <TaskCompletionExpenseModal
          task={{
            id: activeCtx.task.id as string,
            debtor_id: activeCtx.task.debtor_id as string,
            case_id: (activeCtx.task.case_id as string | null) ?? null,
            branch_id: (activeCtx.task.branch_id as string | null) ?? null,
          }}
          taskLabel={activeCtx.label}
          expenseDefs={activeCtx.expenseDefs}
          onClose={() => finishQueueItem(false, 'أُلغيت الصرفيات')}
          onConfirmed={(rows) => {
            setBatchPendingExpenses(rows)
            setBatchExpenseStepDone(true)
            setShowExpense(false)
            setShowCompletion(true)
          }}
        />
      )}

      {activeCtx && showCompletion && !showExpense && (
        <LawyerTaskCompletionModal
          task={activeCtx.task as any}
          reqFields={activeCtx.reqFields}
          fee={activeCtx.fee}
          taskLabel={activeCtx.label}
          pendingExpenses={batchPendingExpenses}
          expenseStepDone={batchExpenseStepDone}
          onClose={() => finishQueueItem(false, 'أُلغي إدخال الحقول')}
          onSubmitted={() => finishQueueItem(true)}
          skipRouterRefresh
        />
      )}
    </>
  )
}
