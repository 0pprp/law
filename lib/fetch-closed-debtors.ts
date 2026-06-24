import type { SupabaseClient } from '@supabase/supabase-js'
import { TASK_TYPE_LABELS } from '@/lib/types'
import type { TaskType } from '@/lib/types'

export interface ClosedDebtorRow {
  id: string
  full_name: string
  phone: string | null
  id_number: string | null
  required_amount: number
  closed_at: string | null
  created_at: string
  branch_id: string | null
  last_task_id: string | null
}

function taskLabel(
  task: { task_type?: string | null; task_definition_id?: string | null },
  defMap: Map<string, string>,
): string {
  const fromDef = task.task_definition_id ? defMap.get(task.task_definition_id) : undefined
  return fromDef ?? TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type ?? '—'
}

async function loadDefinitionLabels(
  supabase: SupabaseClient,
  tasks: { task_definition_id?: string | null }[],
): Promise<Map<string, string>> {
  const defIds = [...new Set(tasks.map(t => t.task_definition_id).filter(Boolean))] as string[]
  if (!defIds.length) return new Map()

  const { data } = await supabase.from('task_definitions').select('id, label').in('id', defIds)
  return new Map((data ?? []).map(d => [d.id, d.label]))
}

/** Resolve display label for the last completed/approved task per closed debtor. */
export async function fetchLastTaskLabelsForDebtors(
  supabase: SupabaseClient,
  rows: ClosedDebtorRow[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (!rows.length) return labels

  const lastTaskIds = [...new Set(rows.map(r => r.last_task_id).filter(Boolean))] as string[]
  if (lastTaskIds.length > 0) {
    const { data } = await supabase
      .from('tasks')
      .select('id, debtor_id, task_type, task_definition_id')
      .in('id', lastTaskIds)

    const defMap = await loadDefinitionLabels(supabase, data ?? [])
    for (const task of data ?? []) {
      labels.set(task.debtor_id, taskLabel(task, defMap))
    }
  }

  const missingDebtorIds = rows.filter(r => !labels.has(r.id)).map(r => r.id)
  if (missingDebtorIds.length === 0) return labels

  const { data: approvedTasks } = await supabase
    .from('tasks')
    .select('debtor_id, task_type, task_status, completed_at, updated_at, task_definition_id')
    .in('debtor_id', missingDebtorIds)
    .or('task_status.eq.approved,task_status.eq.completed')

  const defMap = await loadDefinitionLabels(supabase, approvedTasks ?? [])
  const byDebtor = new Map<string, NonNullable<typeof approvedTasks>>()
  for (const task of approvedTasks ?? []) {
    const list = byDebtor.get(task.debtor_id) ?? []
    list.push(task)
    byDebtor.set(task.debtor_id, list)
  }

  for (const [debtorId, tasks] of byDebtor) {
    const sorted = [...tasks].sort((a, b) => {
      const aTs = a.completed_at ?? a.updated_at ?? ''
      const bTs = b.completed_at ?? b.updated_at ?? ''
      return bTs.localeCompare(aTs)
    })
    if (sorted[0]) labels.set(debtorId, taskLabel(sorted[0], defMap))
  }

  return labels
}

function normalizeDebtor(raw: Record<string, unknown>): ClosedDebtorRow {
  return {
    id: String(raw.id),
    full_name: String(raw.full_name ?? '—'),
    phone: (raw.phone as string | null) ?? null,
    id_number: (raw.id_number as string | null) ?? null,
    required_amount: Number(raw.required_amount ?? raw.receipt_amount ?? 0),
    closed_at: (raw.closed_at as string | null) ?? null,
    created_at: String(raw.created_at ?? ''),
    branch_id: (raw.branch_id as string | null) ?? null,
    last_task_id: (raw.last_task_id as string | null) ?? null,
  }
}

async function queryClosedByStatusColumn(
  supabase: SupabaseClient,
  branchId: string,
  statusColumn: 'case_status' | 'status',
): Promise<{ rows: Record<string, unknown>[] | null; error?: string }> {
  const base = () =>
    supabase.from('debtors').select('*').eq('branch_id', branchId).eq(statusColumn, 'closed')

  const byClosedAt = await base().order('closed_at', { ascending: false })
  if (!byClosedAt.error) return { rows: (byClosedAt.data ?? []) as Record<string, unknown>[] }

  const byCreatedAt = await base().order('created_at', { ascending: false })
  if (!byCreatedAt.error) return { rows: (byCreatedAt.data ?? []) as Record<string, unknown>[] }

  return { rows: null, error: byCreatedAt.error?.message ?? byClosedAt.error?.message }
}

/**
 * Closed debtors for a branch — source of truth: case_status/status = 'closed' only.
 * Does not use activity_logs or current_task_id.
 */
export async function fetchBranchClosedDebtors(
  supabase: SupabaseClient,
  branchId: string,
): Promise<{ rows: ClosedDebtorRow[]; error?: string }> {
  const attempts: Array<'case_status' | 'status'> = ['case_status', 'status']
  let lastMessage = ''

  for (const col of attempts) {
    const { rows, error } = await queryClosedByStatusColumn(supabase, branchId, col)
    if (rows) return { rows: rows.map(normalizeDebtor) }
    if (error) lastMessage = error
  }

  return { rows: [], error: lastMessage || 'تعذّر تحميل القضايا المحسومة' }
}

