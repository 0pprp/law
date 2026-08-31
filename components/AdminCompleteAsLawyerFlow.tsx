'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LawyerTaskCompletionModal, IncompleteWithoutCompletionModal } from '@/components/TaskUpdateForm'
import TaskCompletionExpenseModal from '@/components/TaskCompletionExpenseModal'
import HybridTaskSelectionModal, { type HybridSelectionResult } from '@/components/HybridTaskSelectionModal'
import AdminNextTaskModal from '@/components/AdminNextTaskModal'
import {
  fetchHybridTaskLinks,
  hybridFieldKey,
  type HybridLinkInfo,
} from '@/lib/hybrid-task-links'
import { REQUIRED_FIELD_LABELS } from '@/lib/types'
import type { RequiredField } from '@/lib/types'
import {
  getTaskExpenses,
  normalizeExpenseRows,
  taskHasExpenses,
  type TaskDefinitionExpense,
} from '@/lib/task-definition-expenses'
import { fetchLawyerTaskExpenses, mergeExpenseSources } from '@/lib/fetch-lawyer-task-expenses'
import { resolveTaskLabel } from '@/lib/task-display-label'
import type { PendingTaskExpense } from '@/lib/persist-task-expenses'
import { visibleTaskFeeAmount } from '@/lib/visible-task-fee'
import { appAlert } from '@/lib/app-dialog'
import type { LawyerAssignedTaskRow } from '@/lib/admin-lawyer-stats'

interface ReqField {
  id: string
  field_key: string
  field_type: string
  field_label: string | null
  is_required: boolean
  sort_order: number
}

type DefBundle = {
  id: string
  label: string
  fee_amount: number
  task_type: string | null
  fields: ReqField[]
  expenses: TaskDefinitionExpense[]
}

type LoadedCtx = {
  task: Record<string, any>
  reqFields: ReqField[]
  expenseDefs: TaskDefinitionExpense[]
  fee: number
  label: string
  definitionId: string | null
}

export type AdminCompleteResult = {
  autoNext?: { ok: boolean; nextLabel?: string; error?: string } | null
  needsNextTask?: boolean
}

function unwrapDef(raw: unknown): { label?: string | null; fee_amount?: number | null; task_type?: string | null } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return (raw[0] as { label?: string | null; fee_amount?: number | null; task_type?: string | null }) ?? null
  return raw as { label?: string | null; fee_amount?: number | null; task_type?: string | null }
}

async function loadTaskContext(
  row: LawyerAssignedTaskRow,
  viewerRole: string | null,
): Promise<LoadedCtx | null> {
  const supabase = createClient()
  const { data: task } = await supabase.from('tasks').select('*').eq('id', row.id).single()
  if (!task) return null

  let debtor: Record<string, unknown> | null = null
  if (task.debtor_id) {
    const { data } = await supabase
      .from('debtors')
      .select('full_name, receipt_number, case_type, court_name, phone, latitude, longitude, current_task_id, last_task_id, case_status')
      .eq('id', task.debtor_id)
      .maybeSingle()
    debtor = data
  }

  const taskWithDebtor = { ...task, debtors: debtor ?? row.debtors ?? null }
  const debtorCaseType = (debtor?.case_type as string | null) ?? row.debtors?.case_type ?? null
  const rowDef = unwrapDef(row.task_definitions)

  let fee = visibleTaskFeeAmount(Number(task.reward_amount ?? rowDef?.fee_amount ?? 0), debtorCaseType, viewerRole)
  let reqFields: ReqField[] = []
  let defLabel: string | null = rowDef?.label ?? null
  let defType: string | null = rowDef?.task_type ?? task.task_type ?? null
  let definitionId: string | null = task.task_definition_id ?? row.task_definition_id ?? null
  let expenseDefsFromEmbed: TaskDefinitionExpense[] = []

  if (definitionId) {
    const { data: def } = await supabase
      .from('task_definitions')
      .select('id, fee_amount, label, task_type, task_required_fields(*), task_definition_expenses(id, task_definition_id, name, max_amount, sort_order)')
      .eq('id', definitionId)
      .maybeSingle()
    if (def) {
      fee = visibleTaskFeeAmount(
        Number(task.reward_amount ?? def.fee_amount ?? 0),
        debtorCaseType,
        viewerRole,
      )
      reqFields = ((def as { task_required_fields?: ReqField[] }).task_required_fields ?? [])
        .sort((a, b) => a.sort_order - b.sort_order)
      defLabel = def.label ?? defLabel
      defType = def.task_type ?? defType
      definitionId = def.id
      expenseDefsFromEmbed = normalizeExpenseRows(
        (def as { task_definition_expenses?: unknown }).task_definition_expenses,
      )
    }
  }

  let expenseDefs = expenseDefsFromEmbed
  if (expenseDefs.length === 0) {
    const [{ expenses: apiExpenses }, { expenses: localExpenses }] = await Promise.all([
      fetchLawyerTaskExpenses(task.id as string),
      getTaskExpenses(supabase, {
        taskDefinitionId: definitionId,
        taskName: defLabel,
        branchId: task.branch_id,
        taskType: defType ?? task.task_type,
      }),
    ])
    expenseDefs = mergeExpenseSources(apiExpenses, localExpenses)
  }

  return {
    task: taskWithDebtor,
    reqFields,
    expenseDefs,
    fee,
    label: resolveTaskLabel(defType ?? task.task_type, defLabel),
    definitionId,
  }
}

async function loadDefinitionBundles(definitionIds: string[]): Promise<DefBundle[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('task_definitions')
    .select('id, label, fee_amount, task_type, task_required_fields(*), task_definition_expenses(id, task_definition_id, name, max_amount, sort_order)')
    .in('id', definitionIds)

  if (error || !data?.length) return []

  const byId = new Map(data.map(d => [String(d.id), d]))
  return definitionIds.map(id => {
    const row = byId.get(id) as {
      id: string
      label?: string | null
      fee_amount?: number | null
      task_type?: string | null
      task_required_fields?: ReqField[]
      task_definition_expenses?: unknown
    } | undefined
    if (!row) {
      return { id, label: 'مهمة', fee_amount: 0, task_type: null, fields: [], expenses: [] }
    }
    return {
      id: String(row.id),
      label: String(row.label ?? 'مهمة'),
      fee_amount: Number(row.fee_amount ?? 0),
      task_type: row.task_type ?? null,
      fields: (row.task_required_fields ?? []).sort((a, b) => a.sort_order - b.sort_order),
      expenses: normalizeExpenseRows(row.task_definition_expenses),
    }
  })
}

function buildAggregatedFields(bundles: DefBundle[], multi: boolean): ReqField[] {
  const out: ReqField[] = []
  for (const bundle of bundles) {
    for (const f of bundle.fields) {
      const key = multi ? hybridFieldKey(bundle.id, f.field_key) : f.field_key
      const baseLabel = f.field_label
        ?? REQUIRED_FIELD_LABELS[f.field_type as RequiredField]
        ?? f.field_type
      out.push({
        ...f,
        id: multi ? `${bundle.id}:${f.id}` : f.id,
        field_key: key,
        field_label: multi ? `${bundle.label} — ${baseLabel}` : f.field_label,
      })
    }
  }
  return out
}

function buildAggregatedExpenses(bundles: DefBundle[], multi: boolean): TaskDefinitionExpense[] {
  const out: TaskDefinitionExpense[] = []
  for (const bundle of bundles) {
    for (const exp of bundle.expenses) {
      out.push({
        ...exp,
        name: multi ? `${bundle.label}: ${exp.name}` : exp.name,
      })
    }
  }
  return out
}

export default function AdminCompleteAsLawyerFlow({
  taskRow,
  viewerRole,
  onClose,
  onFinished,
}: {
  taskRow: LawyerAssignedTaskRow
  viewerRole: string | null
  onClose: () => void
  onFinished: () => void
}) {
  const [phase, setPhase] = useState<'loading' | 'hybrid' | 'expense' | 'complete' | 'incomplete' | 'next' | 'error'>('loading')
  const [error, setError] = useState('')
  const [ctx, setCtx] = useState<LoadedCtx | null>(null)
  const [hybridLinks, setHybridLinks] = useState<HybridLinkInfo[]>([])
  const [hybridParentId, setHybridParentId] = useState<string | null>(null)
  const [hybridSelectedLinked, setHybridSelectedLinked] = useState<HybridLinkInfo[]>([])
  const [completionFields, setCompletionFields] = useState<ReqField[]>([])
  const [modalExpenses, setModalExpenses] = useState<TaskDefinitionExpense[]>([])
  const [pendingExpenses, setPendingExpenses] = useState<PendingTaskExpense[]>([])
  const [expenseStepDone, setExpenseStepDone] = useState(false)
  const [nextTask, setNextTask] = useState<Record<string, any> | null>(null)

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const loaded = await loadTaskContext(taskRow, viewerRole)
        if (cancelled) return
        if (!loaded) {
          setError('تعذر تحميل المهمة')
          setPhase('error')
          return
        }
        setCtx(loaded)
        setCompletionFields(loaded.reqFields)
        setModalExpenses(loaded.expenseDefs)

        const defId = loaded.definitionId
        if (defId) {
          const hybrid = await fetchHybridTaskLinks(defId)
          if (cancelled) return
          if (hybrid.isHybrid && hybrid.links.length > 0) {
            setHybridLinks(hybrid.links)
            setHybridParentId(defId)
            setPhase('hybrid')
            return
          }
        }

        if (taskHasExpenses(loaded.expenseDefs)) {
          setPhase('expense')
        } else {
          setPhase('complete')
        }
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'فشل تحميل بيانات الإنجاز')
        setPhase('error')
      }
    }
    void start()
    return () => { cancelled = true }
  }, [taskRow, viewerRole])

  async function continueAfterHybrid(selection: HybridSelectionResult | null) {
    if (!ctx) return
    const parentId = hybridParentId ?? ctx.definitionId
    const selectedLinked = selection?.selectedLinked ?? []
    const selectedIds = selection?.selectedDefinitionIds ?? (parentId ? [parentId] : [])

    if (selectedLinked.length > 0 && parentId) {
      const bundles = await loadDefinitionBundles(selectedIds)
      const linkedUpdated: HybridLinkInfo[] = selectedLinked.map(l => {
        const b = bundles.find(x => x.id === l.linked_definition_id)
        return b
          ? { ...l, task_type: b.task_type, fee_amount: b.fee_amount || l.fee_amount, label: b.label || l.label }
          : l
      })
      setHybridSelectedLinked(linkedUpdated)
      const fields = buildAggregatedFields(bundles, true)
      const expenses = buildAggregatedExpenses(bundles, true)
      setCompletionFields(fields)
      setModalExpenses(expenses)
      if (expenses.length > 0) setPhase('expense')
      else setPhase('complete')
      return
    }

    setHybridSelectedLinked([])
    setCompletionFields(ctx.reqFields)
    setModalExpenses(ctx.expenseDefs)
    if (taskHasExpenses(ctx.expenseDefs)) setPhase('expense')
    else setPhase('complete')
  }

  async function handleAdminApproved(result: AdminCompleteResult & { completionData?: Record<string, string> }) {
    if (!ctx) {
      onFinished()
      return
    }
    if (result.autoNext?.ok) {
      await appAlert({
        title: 'تم الإنجاز والاعتماد',
        message: result.autoNext.nextLabel
          ? `أُنشئت المهمة التالية تلقائياً: ${result.autoNext.nextLabel}`
          : 'تم إنجاز المهمة واعتمادها.',
        variant: 'success',
      })
      onFinished()
      return
    }
    if (result.needsNextTask) {
      setNextTask({
        ...ctx.task,
        task_status: 'approved',
        completion_data: result.completionData ?? ctx.task.completion_data,
      })
      setPhase('next')
      return
    }
    onFinished()
  }

  if (phase === 'loading') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{ background: 'rgba(35,31,32,0.7)', backdropFilter: 'blur(3px)' }}>
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 text-center" dir="rtl">
          <p className="text-sm font-bold text-[#231F20]">جارٍ تجهيز نموذج الإنجاز...</p>
          <svg className="w-6 h-6 animate-spin text-[#2C8780] mx-auto mt-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        style={{ background: 'rgba(35,31,32,0.7)', backdropFilter: 'blur(3px)' }}>
        <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 text-center space-y-3" dir="rtl">
          <p className="text-sm font-bold text-red-600">{error || 'حدث خطأ'}</p>
          <button type="button" onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-semibold border border-slate-200">
            إغلاق
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      {phase === 'hybrid' && ctx && hybridParentId && (
        <HybridTaskSelectionModal
          parentLabel={ctx.label}
          parentFee={ctx.fee}
          parentDefinitionId={hybridParentId}
          links={hybridLinks}
          onClose={onClose}
          onContinue={result => void continueAfterHybrid(result)}
        />
      )}

      {phase === 'expense' && ctx && (
        <TaskCompletionExpenseModal
          mode="draft"
          task={{
            id: ctx.task.id,
            debtor_id: ctx.task.debtor_id,
            case_id: ctx.task.case_id ?? null,
            branch_id: ctx.task.branch_id ?? null,
          }}
          taskLabel={ctx.label}
          expenseDefs={modalExpenses}
          onClose={onClose}
          onConfirmed={rows => {
            setPendingExpenses(rows)
            setExpenseStepDone(true)
            setPhase('complete')
          }}
        />
      )}

      {phase === 'complete' && ctx && (
        <LawyerTaskCompletionModal
          task={ctx.task as any}
          reqFields={completionFields}
          fee={ctx.fee}
          taskLabel={ctx.label}
          pendingExpenses={pendingExpenses}
          expenseStepDone={expenseStepDone}
          hybridParentDefinitionId={hybridSelectedLinked.length ? hybridParentId : null}
          hybridSelectedLinked={hybridSelectedLinked}
          adminAutoApprove
          skipRouterRefresh
          onClose={onClose}
          onSubmitted={() => {}}
          onAdminApproved={result => void handleAdminApproved(result)}
          onRequestIncomplete={() => setPhase('incomplete')}
        />
      )}

      {phase === 'incomplete' && ctx && (
        <IncompleteWithoutCompletionModal
          task={ctx.task as any}
          taskLabel={ctx.label}
          adminAutoApprove
          skipRouterRefresh
          onClose={() => setPhase('complete')}
          onSubmitted={onFinished}
        />
      )}

      {phase === 'next' && nextTask && (
        <AdminNextTaskModal
          task={nextTask}
          onClose={() => { onFinished() }}
          onDone={onFinished}
        />
      )}
    </>
  )
}
