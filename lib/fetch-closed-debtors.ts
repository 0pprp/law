import type { SupabaseClient } from '@supabase/supabase-js'
import { TASK_TYPE_LABELS } from '@/lib/types'
import type { TaskType } from '@/lib/types'

export const CLOSED_CASES_PAGE_SIZE = 50

export interface ClosedDebtorRow {
  id: string
  full_name: string
  phone: string | null
  receipt_number: string | null
  id_number: string | null
  required_amount: number
  closed_at: string | null
  created_at: string
  branch_id: string | null
  last_task_id: string | null
  case_type: 'civil' | 'criminal'
}

const CLOSED_DEBTOR_COLS =
  'id, full_name, phone, receipt_number, id_number, required_amount, closed_at, created_at, branch_id, last_task_id, case_type'

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
      .select('id, debtor_id, task_type, task_definition_id, branch_id')
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
    .select('debtor_id, task_type, task_status, completed_at, updated_at, task_definition_id, branch_id')
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

/** Sum payments for a set of debtors (current page only). */
export async function fetchPaymentTotalsForDebtors(
  supabase: SupabaseClient,
  branchId: string | null,
  debtorIds: string[],
): Promise<Map<string, number>> {
  const paidMap = new Map<string, number>()
  if (!debtorIds.length) return paidMap

  const CHUNK = 200
  for (let i = 0; i < debtorIds.length; i += CHUNK) {
    const slice = debtorIds.slice(i, i + CHUNK)
    let q = supabase
      .from('debtor_payments')
      .select('debtor_id, amount')
      .in('debtor_id', slice)
    if (branchId) q = q.eq('branch_id', branchId)
    const { data: payments } = await q

    for (const p of payments ?? []) {
      paidMap.set(p.debtor_id, (paidMap.get(p.debtor_id) ?? 0) + Number(p.amount))
    }
  }

  return paidMap
}

function normalizeDebtor(raw: Record<string, unknown>): ClosedDebtorRow {
  return {
    id: String(raw.id),
    full_name: String(raw.full_name ?? '—'),
    phone: (raw.phone as string | null) ?? null,
    receipt_number: (raw.receipt_number as string | null) ?? null,
    id_number: (raw.id_number as string | null) ?? null,
    required_amount: Number(raw.required_amount ?? raw.receipt_amount ?? 0),
    closed_at: (raw.closed_at as string | null) ?? null,
    created_at: String(raw.created_at ?? ''),
    branch_id: (raw.branch_id as string | null) ?? null,
    last_task_id: (raw.last_task_id as string | null) ?? null,
    case_type: raw.case_type === 'criminal' ? 'criminal' : 'civil',
  }
}

export interface FetchClosedDebtorsOptions {
  offset?: number
  limit?: number
  debtorIds?: string[] | null
  caseType?: 'civil' | 'criminal' | null
  branchListId?: string | null
}

export interface PaginatedClosedDebtorsResult {
  rows: ClosedDebtorRow[]
  total: number
  error?: string
}

async function queryClosedPaginated(
  supabase: SupabaseClient,
  branchId: string | null,
  statusColumn: 'case_status' | 'status',
  options?: FetchClosedDebtorsOptions,
): Promise<PaginatedClosedDebtorsResult | null> {
  const limit = options?.limit ?? CLOSED_CASES_PAGE_SIZE
  const offset = options?.offset ?? 0

  const buildQuery = () => {
    let q = supabase
      .from('debtors')
      .select(CLOSED_DEBTOR_COLS, { count: 'exact' })
      .eq(statusColumn, 'closed')
    if (branchId) q = q.eq('branch_id', branchId)
    if (options?.branchListId) q = q.eq('branch_list_id', options.branchListId)
    if (options?.caseType) q = q.eq('case_type', options.caseType)
    if (options?.debtorIds?.length) q = q.in('id', options.debtorIds)
    return q
  }

  const byClosedAt = await buildQuery().order('closed_at', { ascending: false }).range(offset, offset + limit - 1)
  if (!byClosedAt.error) {
    return {
      rows: ((byClosedAt.data ?? []) as Record<string, unknown>[]).map(normalizeDebtor),
      total: byClosedAt.count ?? 0,
    }
  }

  const byCreatedAt = await buildQuery().order('created_at', { ascending: false }).range(offset, offset + limit - 1)
  if (!byCreatedAt.error) {
    return {
      rows: ((byCreatedAt.data ?? []) as Record<string, unknown>[]).map(normalizeDebtor),
      total: byCreatedAt.count ?? 0,
    }
  }

  return {
    rows: [],
    total: 0,
    error: byCreatedAt.error?.message ?? byClosedAt.error?.message,
  }
}

/**
 * Closed debtors — paginated. branchId=null → كل الفروع.
 */
export async function fetchBranchClosedDebtorsPaginated(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchClosedDebtorsOptions,
): Promise<PaginatedClosedDebtorsResult> {
  const attempts: Array<'case_status' | 'status'> = ['case_status', 'status']
  let lastMessage = ''

  for (const col of attempts) {
    const result = await queryClosedPaginated(supabase, branchId, col, options)
    if (result && !result.error) return result
    if (result?.error) lastMessage = result.error
  }

  return { rows: [], total: 0, error: lastMessage || 'تعذّر تحميل القضايا المحسومة' }
}

/** @deprecated Prefer fetchBranchClosedDebtorsPaginated for list pages. */
export async function fetchBranchClosedDebtors(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<{ rows: ClosedDebtorRow[]; error?: string }> {
  const all: ClosedDebtorRow[] = []
  let offset = 0
  let total = 0

  while (true) {
    const page = await fetchBranchClosedDebtorsPaginated(supabase, branchId, {
      offset,
      limit: CLOSED_CASES_PAGE_SIZE,
    })
    if (page.error && !page.rows.length) return { rows: [], error: page.error }
    all.push(...page.rows)
    total = page.total
    if (page.rows.length < CLOSED_CASES_PAGE_SIZE) break
    offset += CLOSED_CASES_PAGE_SIZE
  }

  return { rows: all, total } as { rows: ClosedDebtorRow[]; error?: string }
}
