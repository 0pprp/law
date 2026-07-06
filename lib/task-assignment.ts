import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskStatus } from '@/lib/types'
import { endOfLocalDay, endOfNextLocalDay } from '@/lib/local-date'
import { fetchAssignmentLawyers } from '@/lib/branch-profiles'
import { isGeneralLawyerType } from '@/lib/lawyer-type'
import { formatErrorMessage } from '@/lib/format-error'

const LAWYER_TASK_LIST_COLS =
  'id, task_type, task_definition_id, task_status, due_date, court_name, governorate, created_at, debtor_id, assignment_expires_at, admin_notes, assigned_to, reward_amount, branch_id'

const LAWYER_TASK_REJECTION_COL = ', assignment_rejected_by'

type LawyerTaskListRaw = {
  id: string
  task_type: string | null
  task_definition_id: string | null
  task_status: string
  due_date: string | null
  court_name: string | null
  governorate: string | null
  created_at: string
  debtor_id: string
  assignment_expires_at?: string | null
  admin_notes?: string | null
  assigned_to?: string | null
  assignment_rejected_by?: string | null
  reward_amount?: number | null
  branch_id?: string | null
  give_up_reason?: string | null
}

function isMissingAssignmentRejectionColumn(error: unknown): boolean {
  return formatErrorMessage(error).toLowerCase().includes('assignment_rejected_by')
}

export interface CurrentBranchTaskRow {
  id: string
  task_status: string
  created_at: string
  due_date: string | null
  assigned_at: string | null
  debtor_id: string
  task_definition_id: string | null
  task_type: string | null
  branch_id: string | null
  lawyerId: string | null
  lawyerName: string | null
  debtorName: string
  debtorPhone: string | null
  debtorReceiptNumber: string | null
  taskLabel: string
}

/** DB may use assigned_to and/or lawyer_id — treat either as the assigned lawyer. */
export function taskLawyerId(task: {
  assigned_to?: string | null
  lawyer_id?: string | null
}): string | null {
  return task.assigned_to ?? task.lawyer_id ?? null
}

function taskMatchesBranch(task: { branch_id?: string | null }, branchId: string): boolean {
  return task.branch_id === branchId
}

export const REVIEW_QUEUE_STATUSES = ['submitted', 'pending_review'] as const

export type ReviewQueueStatus = (typeof REVIEW_QUEUE_STATUSES)[number]

export interface PendingReviewTask {
  id: string
  task_type: string | null
  task_status: string
  due_date: string | null
  assigned_at: string | null
  completed_at: string | null
  debtor_id: string
  task_definition_id: string | null
  branch_id: string | null
  assigned_to: string | null
  reward_amount: number
  court_name: string | null
  court_id: string | null
  lawyer_notes: string | null
  admin_notes: string | null
  completion_data: Record<string, unknown> | null
  created_at: string
  debtors: {
    id: string
    full_name: string
    phone: string | null
    governorate: string | null
    case_status: string | null
    branch_id: string | null
    latitude?: number | null
    longitude?: number | null
  } | null
  lawyer: { id: string; full_name: string } | null
  task_definitions: { id: string; label: string } | null
  courts: { name: string } | null
}

function taskBelongsToBranch(
  task: { branch_id?: string | null },
  debtor: { branch_id?: string | null } | null | undefined,
  branchId: string,
): boolean {
  const effective = task.branch_id ?? debtor?.branch_id ?? null
  return effective === branchId
}

export interface FetchPendingReviewOptions {
  offset?: number
  limit?: number
  lawyerId?: string | null
  includeCompletionData?: boolean
}

export interface PaginatedPendingReviewResult {
  tasks: PendingReviewTask[]
  total: number
}

const REVIEW_TASK_LIST_COLS =
  'id, task_type, task_status, due_date, assigned_at, completed_at, debtor_id, task_definition_id, branch_id, assigned_to, reward_amount, court_id, court_name, lawyer_notes, admin_notes, created_at'

const REVIEW_TASK_DETAIL_COLS = `${REVIEW_TASK_LIST_COLS}, completion_data`

async function hydratePendingReviewTasks(
  supabase: SupabaseClient,
  branchId: string,
  rawTasks: Record<string, unknown>[],
): Promise<PendingReviewTask[]> {
  if (!rawTasks.length) return []

  const debtorIds = [...new Set(rawTasks.map(t => t.debtor_id as string))]
  const { data: debtors } = await supabase
    .from('debtors')
    .select('id, full_name, phone, governorate, case_status, branch_id')
    .eq('branch_id', branchId)
    .in('id', debtorIds)
    .not('case_status', 'eq', 'closed')

  const debtorMap = new Map((debtors ?? []).map(d => [d.id, d]))
  const branchTasks = rawTasks.filter(t => debtorMap.has(t.debtor_id as string))
  if (!branchTasks.length) return []

  const lawyerIds = [...new Set(branchTasks.map(t => t.assigned_to).filter(Boolean))] as string[]
  const defIds = [...new Set(branchTasks.map(t => t.task_definition_id).filter(Boolean))] as string[]
  const courtIds = [...new Set(branchTasks.map(t => t.court_id).filter(Boolean))] as string[]

  const [{ data: lawyers }, { data: defs }, { data: courts }] = await Promise.all([
    lawyerIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', lawyerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    defIds.length
      ? supabase.from('task_definitions').select('id, label').in('id', defIds)
      : Promise.resolve({ data: [] as { id: string; label: string }[] }),
    courtIds.length
      ? (supabase as any).from('courts').select('id, name').in('id', courtIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ])

  const lawyerMap = new Map((lawyers ?? []).map(l => [l.id, l]))
  const defMap = new Map((defs ?? []).map(d => [d.id, d]))
  const courtMap = new Map(((courts as { id: string; name: string }[]) ?? []).map(c => [c.id, c]))

  return branchTasks.map(t => {
    const d = debtorMap.get(t.debtor_id as string)!
    const lawyer = t.assigned_to ? lawyerMap.get(t.assigned_to as string) : null
    const def = t.task_definition_id ? defMap.get(t.task_definition_id as string) : null
    const court = t.court_id ? courtMap.get(t.court_id as string) : null
    return {
      ...t,
      debtors: d,
      lawyer: lawyer ? { id: lawyer.id, full_name: lawyer.full_name } : null,
      task_definitions: def ? { id: def.id, label: def.label } : null,
      courts: court ? { name: court.name } : null,
    } as PendingReviewTask
  })
}

/**
 * Single source for dashboard «بانتظار المراجعة» + /admin/tasks/review.
 */
export async function fetchPendingReviewTasksPaginated(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchPendingReviewOptions,
): Promise<PaginatedPendingReviewResult> {
  if (!branchId) return { tasks: [], total: 0 }

  const limit = options?.limit ?? REVIEW_TASK_PAGE_SIZE
  const offset = options?.offset ?? 0
  const cols = options?.includeCompletionData ? REVIEW_TASK_DETAIL_COLS : REVIEW_TASK_LIST_COLS

  let q = supabase
    .from('tasks')
    .select(cols, { count: 'exact' })
    .in('task_status', [...REVIEW_QUEUE_STATUSES])
    .eq('branch_id', branchId)
    .not('assigned_to', 'is', null)
    .not('debtor_id', 'is', null)
    .order('completed_at', { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (options?.lawyerId) q = q.eq('assigned_to', options.lawyerId)

  const { data: rawTasks, count, error } = await q
  if (error) {
    console.error('[fetchPendingReviewTasksPaginated]', error.message ?? error)
    return { tasks: [], total: 0 }
  }

  const tasks = await hydratePendingReviewTasks(supabase, branchId, (rawTasks ?? []) as unknown as Record<string, unknown>[])
  return { tasks, total: count ?? tasks.length }
}

export async function fetchPendingReviewTaskById(
  supabase: SupabaseClient,
  branchId: string,
  taskId: string,
): Promise<PendingReviewTask | null> {
  const { data, error } = await supabase
    .from('tasks')
    .select(REVIEW_TASK_DETAIL_COLS)
    .eq('branch_id', branchId)
    .eq('id', taskId)
    .in('task_status', [...REVIEW_QUEUE_STATUSES])
    .maybeSingle()

  if (error || !data) return null
  const [task] = await hydratePendingReviewTasks(supabase, branchId, [data as unknown as Record<string, unknown>])
  return task ?? null
}

export async function fetchPendingReviewTasks(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchPendingReviewOptions,
): Promise<PendingReviewTask[]> {
  if (!branchId) return []

  const all: PendingReviewTask[] = []
  let offset = 0
  const limit = options?.limit ?? REVIEW_TASK_PAGE_SIZE

  while (true) {
    const page = await fetchPendingReviewTasksPaginated(supabase, branchId, {
      ...options,
      offset,
      limit,
      includeCompletionData: options?.includeCompletionData ?? true,
    })
    all.push(...page.tasks)
    if (page.tasks.length < limit) break
    offset += limit
  }

  return all
}

/** Hero metric — direct COUNT query, no full task fetch. */
export async function fetchPendingReviewCount(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<number> {
  if (!branchId) return 0
  const { count } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .in('task_status', [...REVIEW_QUEUE_STATUSES])
    .eq('branch_id', branchId)
  return count ?? 0
}

export interface UnassignedStageCount {
  id: string
  label: string
  sortOrder: number
  count: number
}

export const CURRENT_TASK_PAGE_SIZE = 50
export const REVIEW_TASK_PAGE_SIZE = 20
export const LAWYER_TASK_PAGE_SIZE = 30

const STATS_CHUNK_SIZE = 500

const CURRENT_TASK_EMBED = `
  id,
  full_name,
  phone,
  receipt_number,
  current_task_id,
  case_status,
  current_task:tasks!current_task_id(
    id,
    task_status,
    created_at,
    due_date,
    assigned_at,
    debtor_id,
    task_definition_id,
    task_type,
    assigned_to,
    branch_id,
    task_definitions(id, label)
  )
`

const CURRENT_TASK_EMBED_INNER = `
  id,
  full_name,
  phone,
  receipt_number,
  current_task_id,
  case_status,
  current_task:tasks!current_task_id!inner(
    id,
    task_status,
    created_at,
    due_date,
    assigned_at,
    debtor_id,
    task_definition_id,
    task_type,
    assigned_to,
    branch_id,
    task_definitions(id, label)
  )
`

export interface FetchCurrentBranchTasksOptions {
  assigned?: boolean
  taskDefinitionId?: string | null
  branchListId?: string | null
  debtorIds?: string[] | null
  offset?: number
  limit?: number
}

export interface PaginatedCurrentTasksResult {
  rows: CurrentBranchTaskRow[]
  total: number
  unassignedTotal: number
  assignedTotal: number
}

interface CurrentTaskMeta {
  unassigned: number
  assigned: number
  stageCounts: Map<string, number>
}

function debtorRowsToTaskRows(debtors: any[], branchId: string): CurrentBranchTaskRow[] {
  const rows: CurrentBranchTaskRow[] = []
  for (const d of debtors) {
    const task = d.current_task
    if (!task?.id || d.current_task_id !== task.id) continue
    if (!taskMatchesBranch(task, branchId)) continue

    const defLabel = task.task_definitions?.label ?? null
    rows.push({
      id: task.id,
      task_status: task.task_status,
      created_at: task.created_at,
      due_date: task.due_date,
      assigned_at: task.assigned_at ?? null,
      debtor_id: d.id,
      task_definition_id: task.task_definition_id,
      task_type: task.task_type,
      branch_id: task.branch_id,
      lawyerId: taskLawyerId(task),
      lawyerName: null,
      debtorName: d.full_name,
      debtorPhone: d.phone ?? null,
      debtorReceiptNumber: d.receipt_number ?? null,
      taskLabel: defLabel ?? task.task_type ?? '—',
    })
  }
  return rows
}

async function attachLawyerNames(
  supabase: SupabaseClient,
  rows: CurrentBranchTaskRow[],
): Promise<void> {
  const lawyerIds = [...new Set(rows.map(r => r.lawyerId).filter(Boolean))] as string[]
  if (!lawyerIds.length) return

  const { data: lawyers } = await supabase.from('profiles').select('id, full_name').in('id', lawyerIds)
  const nameMap = new Map((lawyers ?? []).map(l => [l.id, l.full_name]))
  for (const row of rows) {
    if (row.lawyerId) row.lawyerName = nameMap.get(row.lawyerId) ?? null
  }
}

function applyCurrentTaskListFilters(
  q: ReturnType<SupabaseClient['from']> extends infer _ ? any : never,
  options?: FetchCurrentBranchTasksOptions,
) {
  let query = q
  if (options?.debtorIds?.length) query = query.in('id', options.debtorIds)
  if (options?.branchListId) query = query.eq('branch_list_id', options.branchListId)
  if (options?.taskDefinitionId) {
    query = query.eq('current_task.task_definition_id', options.taskDefinitionId)
  }
  if (options?.assigned === false) query = query.is('current_task.assigned_to', null)
  if (options?.assigned === true) query = query.not('current_task.assigned_to', 'is', null)
  return query
}

/** Chunked scan — counts only, minimal columns. */
async function scanCurrentTaskMeta(
  supabase: SupabaseClient,
  branchId: string,
): Promise<CurrentTaskMeta> {
  let unassigned = 0
  let assigned = 0
  const stageCounts = new Map<string, number>()
  let offset = 0

  while (true) {
    const { data: debtors, error } = await supabase
      .from('debtors')
      .select('current_task_id')
      .eq('branch_id', branchId)
      .not('case_status', 'eq', 'closed')
      .not('current_task_id', 'is', null)
      .order('id')
      .range(offset, offset + STATS_CHUNK_SIZE - 1)

    if (error) {
      console.error('[scanCurrentTaskMeta:debtors]', error.message ?? error)
      break
    }
    if (!debtors?.length) break

    const taskIds = debtors.map(d => d.current_task_id).filter(Boolean) as string[]
    if (taskIds.length) {
      const { data: tasks, error: tErr } = await supabase
        .from('tasks')
        .select('id, assigned_to, task_definition_id')
        .eq('branch_id', branchId)
        .in('id', taskIds)

      if (tErr) {
        console.error('[scanCurrentTaskMeta:tasks]', tErr.message ?? tErr)
      } else {
        for (const task of tasks ?? []) {
          if (taskLawyerId(task)) {
            assigned++
          } else {
            unassigned++
            if (task.task_definition_id) {
              stageCounts.set(
                task.task_definition_id,
                (stageCounts.get(task.task_definition_id) ?? 0) + 1,
              )
            }
          }
        }
      }
    }

    if (debtors.length < STATS_CHUNK_SIZE) break
    offset += STATS_CHUNK_SIZE
  }

  return { unassigned, assigned, stageCounts }
}

async function countCurrentTasksByAssignment(
  supabase: SupabaseClient,
  branchId: string,
  assigned: boolean,
  options?: Pick<FetchCurrentBranchTasksOptions, 'debtorIds' | 'taskDefinitionId' | 'branchListId'>,
): Promise<number> {
  let q = supabase
    .from('debtors')
    .select(`${CURRENT_TASK_EMBED_INNER}`, { count: 'exact', head: true })
    .eq('branch_id', branchId)
    .not('case_status', 'eq', 'closed')
    .not('current_task_id', 'is', null)

  q = applyCurrentTaskListFilters(q, { ...options, assigned })

  const { count, error } = await q
  if (error) {
    console.error('[countCurrentTasksByAssignment]', error.message ?? error)
    return 0
  }
  return count ?? 0
}

export function isUnassignedCurrentTask(row: { lawyerId: string | null }): boolean {
  return !row.lawyerId
}

/** Stage boxes: unassigned current tasks grouped by task_definition_id. */
export async function fetchUnassignedStageCounts(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<UnassignedStageCount[]> {
  const dash = await fetchDashboardData(supabase, branchId)
  return dash.stages
}

/**
 * Paginated current-branch tasks — branch_id first, server-side filters.
 */
export async function fetchCurrentBranchTaskRowsPaginated(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchCurrentBranchTasksOptions,
): Promise<PaginatedCurrentTasksResult> {
  const empty = { rows: [], total: 0, unassignedTotal: 0, assignedTotal: 0 }
  if (!branchId) return empty

  const limit = options?.limit ?? CURRENT_TASK_PAGE_SIZE
  const offset = options?.offset ?? 0

  const [unassignedTotal, assignedTotal] = await Promise.all([
    countCurrentTasksByAssignment(supabase, branchId, false, options),
    countCurrentTasksByAssignment(supabase, branchId, true, options),
  ])

  let q = supabase
    .from('debtors')
    .select(CURRENT_TASK_EMBED_INNER, { count: 'exact' })
    .eq('branch_id', branchId)
    .not('case_status', 'eq', 'closed')
    .not('current_task_id', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  q = applyCurrentTaskListFilters(q, options)

  const { data: debtors, count, error } = await q
  if (error) {
    console.error('[fetchCurrentBranchTaskRowsPaginated]', error.message ?? error)
    return { ...empty, unassignedTotal, assignedTotal }
  }

  const rows = debtorRowsToTaskRows(debtors ?? [], branchId)
  await attachLawyerNames(supabase, rows)

  return {
    rows,
    total: count ?? rows.length,
    unassignedTotal,
    assignedTotal,
  }
}

/**
 * Single source of truth for dashboard hero + /admin/tasks.
 * Prefer fetchCurrentBranchTaskRowsPaginated for list pages.
 */
export async function fetchCurrentBranchTaskRows(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchCurrentBranchTasksOptions,
): Promise<CurrentBranchTaskRow[]> {
  if (!branchId) return []

  const all: CurrentBranchTaskRow[] = []
  let offset = 0
  const limit = CURRENT_TASK_PAGE_SIZE

  while (true) {
    const page = await fetchCurrentBranchTaskRowsPaginated(supabase, branchId, {
      ...options,
      offset,
      limit,
    })
    all.push(...page.rows)
    if (page.rows.length < limit) break
    offset += limit
  }

  return all
}

export async function fetchCurrentTaskStats(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<{ unassigned: number; assigned: number }> {
  if (!branchId) return { unassigned: 0, assigned: 0 }
  const meta = await scanCurrentTaskMeta(supabase, branchId)
  return { unassigned: meta.unassigned, assigned: meta.assigned }
}

/**
 * Combined dashboard load — count/group queries, no full task row fetch.
 */
export async function fetchDashboardData(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<{ stages: UnassignedStageCount[]; unassigned: number; assigned: number }> {
  if (!branchId) return { stages: [], unassigned: 0, assigned: 0 }

  const meta = await scanCurrentTaskMeta(supabase, branchId)
  if (meta.unassigned === 0) {
    return { stages: [], unassigned: 0, assigned: meta.assigned }
  }

  const defIds = [...meta.stageCounts.keys()]
  const { data: defs } = defIds.length
    ? await supabase.from('task_definitions').select('id, label, sort_order').in('id', defIds)
    : { data: [] as { id: string; label: string; sort_order: number }[] }

  const defMap = new Map((defs ?? []).map(d => [d.id, d]))
  const stages: UnassignedStageCount[] = []

  for (const [defId, count] of meta.stageCounts) {
    if (count <= 0) continue
    const def = defMap.get(defId)
    stages.push({
      id: defId,
      label: def?.label ?? '—',
      sortOrder: def?.sort_order ?? 999,
      count,
    })
  }

  stages.sort((a, b) => a.sortOrder - b.sortOrder)

  return {
    stages,
    unassigned: meta.unassigned,
    assigned: meta.assigned,
  }
}

export async function fetchUnassignedCurrentTasks(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<CurrentBranchTaskRow[]> {
  return fetchCurrentBranchTaskRows(supabase, branchId, { assigned: false })
}

export async function fetchAssignedCurrentTasks(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<CurrentBranchTaskRow[]> {
  return fetchCurrentBranchTaskRows(supabase, branchId, { assigned: true })
}

export async function fetchBranchLawyers(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<{ id: string; full_name: string }[]> {
  const { lawyers, error } = await fetchAssignmentLawyers(supabase, branchId)
  if (error) {
    console.error('[fetchBranchLawyers]', error)
    return []
  }
  return lawyers
}

/** Validates that a normal lawyer is only assigned tasks from their branch. */
export async function validateLawyerTaskAssignment(
  supabase: SupabaseClient,
  lawyerId: string,
  taskIds: string[],
): Promise<{ ok: boolean; error: string | null }> {
  if (!taskIds.length) return { ok: false, error: 'لا مهام محددة' }

  const [{ data: lawyer }, { data: tasks }] = await Promise.all([
    supabase.from('profiles').select('role, branch_id, lawyer_type').eq('id', lawyerId).single(),
    supabase.from('tasks').select('id, branch_id').in('id', taskIds),
  ])

  if (!lawyer || lawyer.role !== 'lawyer') {
    return { ok: false, error: 'المحامي غير موجود أو غير صالح' }
  }

  if (isGeneralLawyerType(lawyer.lawyer_type)) {
    return { ok: true, error: null }
  }

  const lawyerBranch = lawyer.branch_id
  if (!lawyerBranch) {
    return { ok: false, error: 'المحامي العادي يجب أن يكون مرتبطاً بفرع' }
  }

  const invalid = (tasks ?? []).find(t => t.branch_id && t.branch_id !== lawyerBranch)
  if (invalid) {
    return { ok: false, error: 'لا يمكن تكليف محامٍ عادي بمهام من فرع آخر' }
  }

  return { ok: true, error: null }
}

export function buildPendingAssignmentPayload(lawyerId: string, dueDate?: string) {
  const now = new Date()
  const expires = dueDate
    ? endOfLocalDay(dueDate)
    : endOfNextLocalDay(now)
  const safeExpires = expires.getTime() > now.getTime() ? expires : endOfNextLocalDay(now)

  return {
    assigned_to: lawyerId,
    task_status: 'assignment_pending_acceptance' as TaskStatus,
    assigned_at: now.toISOString(),
    assignment_expires_at: safeExpires.toISOString(),
    assignment_rejected_by: null,
    ...(dueDate ? { due_date: dueDate } : {}),
  }
}

export function buildAssignPayload(lawyerId: string, dueDate?: string) {
  return buildPendingAssignmentPayload(lawyerId, dueDate)
}

function omitPayloadKeys(payload: Record<string, unknown>, keys: string[]) {
  const next = { ...payload }
  for (const k of keys) delete next[k]
  return next
}

/** Apply assignment with fallbacks when optional columns / enum values are missing in DB. */
export async function assignTasksToLawyer(
  supabase: SupabaseClient,
  taskIds: string[],
  lawyerId: string,
  dueDate?: string,
  releasedBy?: string,
): Promise<{ ok: boolean; error: string | null }> {
  if (!taskIds.length) return { ok: false, error: 'لا مهام محددة' }

  const full = buildPendingAssignmentPayload(lawyerId, dueDate) as Record<string, unknown>
  const payloads: Record<string, unknown>[] = [
    full,
    omitPayloadKeys(full, ['assigned_at']),
    omitPayloadKeys(full, ['assigned_at', 'assignment_expires_at']),
    {
      assigned_to: lawyerId,
      task_status: 'assignment_pending_acceptance',
      ...(dueDate ? { due_date: dueDate } : {}),
    },
    {
      assigned_to: lawyerId,
      task_status: 'assigned',
      ...(dueDate ? { due_date: dueDate } : {}),
    },
  ]

  let lastError: unknown = null
  for (const payload of payloads) {
    const { error } = await supabase.from('tasks').update(payload as any).in('id', taskIds)
    if (error) {
      lastError = error
      continue
    }
    const { data: check } = await supabase
      .from('tasks')
      .select('id, assigned_to, task_status')
      .in('id', taskIds)
      .limit(1)
    if (check?.[0]?.assigned_to === lawyerId) {
      return { ok: true, error: null }
    }
  }

  return { ok: false, error: formatErrorMessage(lastError) || 'فشل تكليف المهمة' }
}

export interface FetchLawyerTasksOptions {
  offset?: number
  limit?: number
  status?: TaskStatus | 'all' | 'completed'
  debtorIds?: string[] | null
  branchId?: string | null
}

export interface PaginatedLawyerTasksResult {
  tasks: LawyerTaskRow[]
  total: number
  error: unknown | null
}

export interface LawyerTaskStatusCounts {
  all: number
  assignment_pending_acceptance: number
  assigned: number
  in_progress: number
  submitted: number
  rejected: number
  completed: number
}

/** Lawyer task list — paginated, branch-safe debtor fetch. */
async function queryLawyerTasksPage(
  supabase: SupabaseClient,
  lawyerId: string,
  options: FetchLawyerTasksOptions | undefined,
  trackAssignmentRejections: boolean,
) {
  const limit = options?.limit ?? LAWYER_TASK_PAGE_SIZE
  const offset = options?.offset ?? 0
  const status = options?.status
  const taskCols = trackAssignmentRejections
    ? `${LAWYER_TASK_LIST_COLS}${LAWYER_TASK_REJECTION_COL}`
    : LAWYER_TASK_LIST_COLS

  let q = supabase
    .from('tasks')
    .select(taskCols, { count: 'exact' })
    .not('task_status', 'eq', 'draft')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (trackAssignmentRejections && status === 'rejected') {
    // العدّ فقط — لا نعرض تفاصيل المدين بعد رفض التكليف
    let countQ = supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assignment_rejected_by', lawyerId)
      .is('assigned_to', null)
    const { count, error } = await countQ
    return { data: [], count: count ?? 0, error }
  }

  if (status && status !== 'all') {
    q = q.eq('assigned_to', lawyerId)
    if (status === 'completed') {
      q = q.in('task_status', ['approved', 'completed'])
    } else {
      q = q.eq('task_status', status)
    }
  } else {
    // الكل / الرئيسية — المكلف بها فقط، بدون المرفوضة
    q = q.eq('assigned_to', lawyerId)
  }

  if (options?.debtorIds?.length) q = q.in('debtor_id', options.debtorIds)
  if (options?.branchId) q = q.eq('branch_id', options.branchId)

  return q
}

export async function fetchLawyerAssignedTasksPaginated(
  supabase: SupabaseClient,
  lawyerId: string,
  options?: FetchLawyerTasksOptions,
): Promise<PaginatedLawyerTasksResult> {
  await autoAcceptExpiredAssignments(supabase, { lawyerId })

  let { data: tasks, count, error } = await queryLawyerTasksPage(supabase, lawyerId, options, true)
  if (error && isMissingAssignmentRejectionColumn(error)) {
    ;({ data: tasks, count, error } = await queryLawyerTasksPage(supabase, lawyerId, options, false))
  }
  if (error) {
    console.error('[fetchLawyerAssignedTasksPaginated]', error.message ?? error)
    return { tasks: [], total: 0, error }
  }
  if (!tasks?.length) return { tasks: [], total: count ?? 0, error: null }

  const rawTasks = tasks as LawyerTaskListRaw[]
  // لا تعرض مهاماً رفضها المحامي حتى لو بقيت حالة قديمة في قاعدة البيانات
  const activeTasks = rawTasks.filter((t) => {
      if (t.assigned_to !== lawyerId) return false
      if (t.assignment_rejected_by === lawyerId) return false
      if (t.task_status === 'waiting_assignment' && t.give_up_reason) return false
      return true
    })
  if (!activeTasks.length) return { tasks: [], total: count ?? 0, error: null }

  const debtorIds = [...new Set(activeTasks.map(t => t.debtor_id))]
  const defIds = [...new Set(activeTasks.map(t => t.task_definition_id).filter(Boolean))] as string[]

  const [{ data: debtors }, { data: definitions }] = await Promise.all([
    supabase
      .from('debtors')
      .select('id, full_name, governorate, remaining_amount, phone, receipt_number, branch_id')
      .in('id', debtorIds),
    defIds.length
      ? supabase.from('task_definitions').select('id, label').in('id', defIds)
      : Promise.resolve({ data: [] as { id: string; label: string }[] }),
  ])

  const debtorMap = new Map((debtors ?? []).map(d => [d.id, d]))
  const defMap = new Map((definitions ?? []).map(d => [d.id, d.label]))

  const branchIds = [...new Set(activeTasks.map(t => t.branch_id).filter(Boolean))] as string[]
  const { data: branchRows } = branchIds.length
    ? await supabase.from('branches').select('id, name').in('id', branchIds)
    : { data: [] as { id: string; name: string }[] }
  const branchNameMap = new Map((branchRows ?? []).map(b => [b.id, b.name]))

  return {
    tasks: activeTasks.map(t => {
      const defLabel = t.task_definition_id ? defMap.get(t.task_definition_id) ?? null : null
      const branchId = t.branch_id as string | null
      return {
        ...t,
        task_label: defLabel,
        branch_name: branchId ? branchNameMap.get(branchId) ?? null : null,
        debtors: debtorMap.get(t.debtor_id) ?? null,
      }
    }) as LawyerTaskRow[],
    total: count ?? tasks.length,
    error: null,
  }
}

export async function fetchLawyerTaskStatusCounts(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<LawyerTaskStatusCounts> {
  const statuses = [
    'assignment_pending_acceptance',
    'assigned',
    'in_progress',
    'submitted',
    'rejected',
  ] as const

  const baseAssigned = () =>
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', lawyerId)
      .not('task_status', 'eq', 'draft')

  async function loadCounts(trackAssignmentRejections: boolean) {
    const rejectedAssignmentCount = () =>
      supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('assignment_rejected_by', lawyerId)
        .is('assigned_to', null)

    const allQuery = baseAssigned()

    const [allRes, completedRes, rejectedAssignRes, ...statusRes] = await Promise.all([
      allQuery,
      baseAssigned().in('task_status', ['approved', 'completed']),
      trackAssignmentRejections ? rejectedAssignmentCount() : Promise.resolve({ count: 0, error: null }),
      ...statuses.map(s => baseAssigned().eq('task_status', s)),
    ])

    return { allRes, completedRes, rejectedAssignRes, statusRes }
  }

  let { allRes, completedRes, rejectedAssignRes, statusRes } = await loadCounts(true)
  const allErr = (allRes as { error?: unknown }).error
  if (allErr && isMissingAssignmentRejectionColumn(allErr)) {
    ;({ allRes, completedRes, rejectedAssignRes, statusRes } = await loadCounts(false))
  }

  const counts: LawyerTaskStatusCounts = {
    all: allRes.count ?? 0,
    assignment_pending_acceptance: statusRes[0].count ?? 0,
    assigned: statusRes[1].count ?? 0,
    in_progress: statusRes[2].count ?? 0,
    submitted: statusRes[3].count ?? 0,
    rejected: (statusRes[4].count ?? 0) + (rejectedAssignRes.count ?? 0),
    completed: completedRes.count ?? 0,
  }

  return counts
}

export async function fetchLawyerAssignedTasks(
  supabase: SupabaseClient,
  lawyerId: string,
  options?: FetchLawyerTasksOptions,
) {
  const all: LawyerTaskRow[] = []
  let offset = 0
  const limit = options?.limit ?? LAWYER_TASK_PAGE_SIZE
  let total = 0

  while (true) {
    const page = await fetchLawyerAssignedTasksPaginated(supabase, lawyerId, {
      ...options,
      offset,
      limit,
    })
    if (page.error) return { tasks: all, error: page.error }
    all.push(...page.tasks)
    total = page.total
    if (page.tasks.length < limit) break
    offset += limit
  }

  return { tasks: all, error: null, total }
}

export interface LawyerTaskRow {
  id: string
  task_type: string
  task_definition_id?: string | null
  task_label?: string | null
  task_status: string
  due_date: string | null
  court_name: string | null
  governorate: string | null
  created_at: string
  debtor_id: string
  branch_id?: string | null
  branch_name?: string | null
  assignment_expires_at?: string | null
  admin_notes?: string | null
  assigned_to: string | null
  assignment_rejected_by?: string | null
  reward_amount?: number | null
  debtors: {
    full_name: string
    governorate?: string | null
    remaining_amount?: number | null
    phone?: string | null
    receipt_number?: string | null
  } | null
}

export async function autoAcceptExpiredAssignments(
  supabase: SupabaseClient,
  filters?: { branchId?: string | null; lawyerId?: string },
): Promise<number> {
  const now = new Date().toISOString()
  let q = supabase
    .from('tasks')
    .select('id, assignment_expires_at')
    .eq('task_status', 'assignment_pending_acceptance')
    .lt('assignment_expires_at', now)

  if (filters?.branchId) q = (q as any).eq('branch_id', filters.branchId)
  if (filters?.lawyerId) q = (q as any).eq('assigned_to', filters.lawyerId)

  const { data: expired } = await q
  if (!expired?.length) return 0

  const ids = expired.map(t => t.id)
  await supabase
    .from('tasks')
    .update({
      task_status: 'assigned',
      accepted_at: now,
      acceptance_method: 'auto',
    } as any)
    .in('id', ids)
    .eq('task_status', 'assignment_pending_acceptance')

  return expired.length
}

export async function acceptTaskAssignment(supabase: SupabaseClient, taskId: string) {
  return supabase
    .from('tasks')
    .update({
      task_status: 'assigned',
      accepted_at: new Date().toISOString(),
      acceptance_method: 'manual',
    } as any)
    .eq('id', taskId)
    .eq('task_status', 'assignment_pending_acceptance')
}

export async function rejectTaskAssignment(
  supabase: SupabaseClient,
  taskId: string,
  reason: string,
  lawyerId: string,
) {
  const basePayload = {
    task_status: 'waiting_assignment',
    assigned_to: null,
    assigned_at: null,
    assignment_expires_at: null,
    acceptance_method: null,
    given_up_at: new Date().toISOString(),
    give_up_reason: reason.trim(),
  }

  const withRejection = {
    ...basePayload,
    assignment_rejected_by: lawyerId,
  }

  let { data, error } = await supabase
    .from('tasks')
    .update(withRejection as any)
    .eq('id', taskId)
    .eq('task_status', 'assignment_pending_acceptance')
    .eq('assigned_to', lawyerId)
    .select('id')

  if (error && isMissingAssignmentRejectionColumn(error)) {
    ;({ data, error } = await supabase
      .from('tasks')
      .update(basePayload as any)
      .eq('id', taskId)
      .eq('task_status', 'assignment_pending_acceptance')
      .eq('assigned_to', lawyerId)
      .select('id'))
  }

  if (error) return { data: null, error }
  if (!data?.length) {
    return { data: null, error: { message: 'لم يتم تحديث المهمة — ربما تغيّرت حالتها مسبقاً' } }
  }
  return { data, error: null }
}
