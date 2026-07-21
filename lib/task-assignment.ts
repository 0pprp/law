import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskStatus } from '@/lib/types'
import {
  endOfLocalDay,
  localTodayYmd,
  OVERDUE_TERMINAL_STATUSES,
} from '@/lib/local-date'
import { fetchAssignmentLawyers } from '@/lib/branch-profiles'
import { isGeneralLawyerType } from '@/lib/lawyer-type'
import { formatErrorMessage } from '@/lib/format-error'
import { isFindAddressTaskType } from '@/lib/delegate'

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
  branchName: string | null
  branchListName: string | null
  caseType: 'civil' | 'criminal'
  lawyerId: string | null
  lawyerName: string | null
  lawyerRole: string | null
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

function taskMatchesBranch(task: { branch_id?: string | null }, branchId: string | null): boolean {
  if (!branchId) return true
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
    case_type?: string | null
    branch_id: string | null
    branch_list_id?: string | null
    latitude?: number | null
    longitude?: number | null
  } | null
  lawyer: { id: string; full_name: string; role?: string | null } | null
  task_definitions: { id: string; label: string } | null
  courts: { name: string } | null
}

function taskBelongsToBranch(
  task: { branch_id?: string | null },
  debtor: { branch_id?: string | null } | null | undefined,
  branchId: string | null,
): boolean {
  if (!branchId) return true
  const effective = task.branch_id ?? debtor?.branch_id ?? null
  return effective === branchId
}

export interface FetchPendingReviewOptions {
  offset?: number
  limit?: number
  lawyerId?: string | null
  caseType?: 'civil' | 'criminal' | null
  includeCompletionData?: boolean
  branchListId?: string | null
}

export interface PaginatedPendingReviewResult {
  tasks: PendingReviewTask[]
  total: number
}

const REVIEW_TASK_LIST_COLS =
  'id, task_type, task_status, due_date, assigned_at, completed_at, debtor_id, task_definition_id, branch_id, assigned_to, reward_amount, court_id, court_name, lawyer_notes, admin_notes, created_at'

const REVIEW_TASK_DETAIL_COLS = `${REVIEW_TASK_LIST_COLS}, completion_data`

/** طابور المراجعة عادة صغير — نجلب المهام ثم نفلتر المدين محلياً (بدون embed/URL عملاق). */
const REVIEW_QUEUE_FETCH_CAP = 1000

async function hydratePendingReviewTasks(
  supabase: SupabaseClient,
  branchId: string | null,
  rawTasks: Record<string, unknown>[],
): Promise<PendingReviewTask[]> {
  if (!rawTasks.length) return []

  const debtorIds = [...new Set(rawTasks.map(t => t.debtor_id as string))]
  let debtorsQ = supabase
    .from('debtors')
    .select('id, full_name, phone, governorate, case_status, case_type, branch_id, branch_list_id')
    .in('id', debtorIds)
  if (branchId) debtorsQ = debtorsQ.eq('branch_id', branchId)

  const { data: debtors } = await debtorsQ

  const debtorMap = new Map((debtors ?? []).map(d => [d.id, d]))
  const branchTasks = rawTasks.filter(t => {
    const d = debtorMap.get(t.debtor_id as string)
    if (!d) return false
    if (d.case_status === 'closed') return false
    return taskBelongsToBranch(t as { branch_id?: string | null }, d, branchId)
  })
  if (!branchTasks.length) return []

  const lawyerIds = [...new Set(branchTasks.map(t => t.assigned_to).filter(Boolean))] as string[]
  const defIds = [...new Set(branchTasks.map(t => t.task_definition_id).filter(Boolean))] as string[]
  const courtIds = [...new Set(branchTasks.map(t => t.court_id).filter(Boolean))] as string[]

  const [{ data: lawyers }, { data: defs }, { data: courts }] = await Promise.all([
    lawyerIds.length
      ? supabase.from('profiles').select('id, full_name, role').in('id', lawyerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; role?: string | null }[] }),
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
      lawyer: lawyer ? { id: lawyer.id, full_name: lawyer.full_name, role: lawyer.role ?? null } : null,
      task_definitions: def ? { id: def.id, label: def.label } : null,
      courts: court ? { name: court.name } : null,
    } as PendingReviewTask
  })
}

function filterHydratedReviewTasks(
  tasks: PendingReviewTask[],
  options?: Pick<FetchPendingReviewOptions, 'caseType' | 'branchListId'>,
): PendingReviewTask[] {
  let out = tasks
  if (options?.caseType) {
    out = out.filter(t => (t.debtors?.case_type ?? 'civil') === options.caseType)
  }
  if (options?.branchListId) {
    out = out.filter(t => t.debtors?.branch_list_id === options.branchListId)
  }
  return out
}

/**
 * Single source for dashboard «بانتظار المراجعة» + /admin/tasks/review.
 * نجلب مهام الطابور أولاً (مجموعة صغيرة) ثم نفلتر القضايا المغلقة/النوع/القائمة بعد hydrate.
 */
export async function fetchPendingReviewTasksPaginated(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchPendingReviewOptions,
): Promise<PaginatedPendingReviewResult> {
  const limit = options?.limit ?? REVIEW_TASK_PAGE_SIZE
  const offset = options?.offset ?? 0
  const cols = options?.includeCompletionData ? REVIEW_TASK_DETAIL_COLS : REVIEW_TASK_LIST_COLS

  let q = supabase
    .from('tasks')
    .select(cols)
    .in('task_status', [...REVIEW_QUEUE_STATUSES])
    .not('assigned_to', 'is', null)
    .order('completed_at', { ascending: true, nullsFirst: false })
    .limit(REVIEW_QUEUE_FETCH_CAP)

  if (branchId) q = q.eq('branch_id', branchId)
  if (options?.lawyerId) q = q.eq('assigned_to', options.lawyerId)

  const { data: rawTasks, error } = await q
  if (error) {
    console.error('[fetchPendingReviewTasksPaginated]', error.message || error.code || error)
    return { tasks: [], total: 0 }
  }

  const hydrated = await hydratePendingReviewTasks(
    supabase,
    branchId,
    (rawTasks ?? []) as unknown as Record<string, unknown>[],
  )
  const filtered = filterHydratedReviewTasks(hydrated, options)
  return {
    tasks: filtered.slice(offset, offset + limit),
    total: filtered.length,
  }
}

export async function fetchPendingReviewTaskById(
  supabase: SupabaseClient,
  branchId: string | null,
  taskId: string,
): Promise<PendingReviewTask | null> {
  let q = supabase
    .from('tasks')
    .select(REVIEW_TASK_DETAIL_COLS)
    .eq('id', taskId)
    .in('task_status', [...REVIEW_QUEUE_STATUSES])
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q.maybeSingle()

  if (error || !data) return null
  const [task] = await hydratePendingReviewTasks(supabase, branchId, [data as unknown as Record<string, unknown>])
  return task ?? null
}

export async function fetchPendingReviewTasks(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchPendingReviewOptions,
): Promise<PendingReviewTask[]> {
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

/** Hero metric — same queue rules as review page. branchId=null → كل الفروع. */
export async function fetchPendingReviewCount(
  supabase: SupabaseClient,
  branchId: string | null,
  branchListId?: string | null,
  caseType?: 'civil' | 'criminal' | null,
): Promise<number> {
  const page = await fetchPendingReviewTasksPaginated(supabase, branchId, {
    offset: 0,
    limit: REVIEW_QUEUE_FETCH_CAP,
    caseType: caseType ?? null,
    branchListId: branchListId ?? null,
    includeCompletionData: false,
  })
  return page.total
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
  case_type,
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
    task_definitions(id, label, task_type)
  )
`

const CURRENT_TASK_EMBED_INNER = `
  id,
  full_name,
  phone,
  receipt_number,
  case_type,
  branch_list_id,
  branch_list:branch_lists(name),
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
    task_definitions(id, label, task_type)
  )
`

export interface FetchCurrentBranchTasksOptions {
  assigned?: boolean
  overdue?: boolean
  taskDefinitionId?: string | null
  /** عند «الكل»: عدة تعريفات بنفس الاسم عبر الفروع */
  taskDefinitionIds?: string[] | null
  branchListId?: string | null
  debtorIds?: string[] | null
  caseType?: 'civil' | 'criminal' | null
  offset?: number
  limit?: number
}

export interface PaginatedCurrentTasksResult {
  rows: CurrentBranchTaskRow[]
  total: number
  unassignedTotal: number
  assignedTotal: number
  overdueTotal: number
}

interface CurrentTaskMeta {
  unassigned: number
  assigned: number
  stageCounts: Map<string, number>
  assignedStageCounts: Map<string, number>
  overdueStageCounts: Map<string, number>
}

function debtorRowsToTaskRows(debtors: any[], branchId: string | null): CurrentBranchTaskRow[] {
  const rows: CurrentBranchTaskRow[] = []
  for (const d of debtors) {
    const task = d.current_task
    if (!task?.id || d.current_task_id !== task.id) continue
    if (!taskMatchesBranch(task, branchId)) continue

    const defLabel = task.task_definitions?.label ?? null
    const defType = task.task_definitions?.task_type ?? null
    const bl = Array.isArray(d.branch_list) ? d.branch_list[0] : d.branch_list
    rows.push({
      id: task.id,
      task_status: task.task_status,
      created_at: task.created_at,
      due_date: task.due_date,
      assigned_at: task.assigned_at ?? null,
      debtor_id: d.id,
      task_definition_id: task.task_definition_id,
      task_type: task.task_type ?? defType,
      branch_id: task.branch_id,
      branchName: null,
      branchListName: bl?.name?.trim() ?? null,
      caseType: d.case_type === 'criminal' ? 'criminal' : 'civil',
      lawyerId: taskLawyerId(task),
      lawyerName: null,
      lawyerRole: null,
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

  const { data: lawyers } = await supabase.from('profiles').select('id, full_name, role').in('id', lawyerIds)
  const nameMap = new Map((lawyers ?? []).map(l => [l.id, l.full_name]))
  const roleMap = new Map((lawyers ?? []).map(l => [l.id, l.role as string | null]))
  for (const row of rows) {
    if (row.lawyerId) {
      row.lawyerName = nameMap.get(row.lawyerId) ?? null
      row.lawyerRole = roleMap.get(row.lawyerId) ?? null
    }
  }
}

async function attachBranchNames(
  supabase: SupabaseClient,
  rows: CurrentBranchTaskRow[],
): Promise<void> {
  const branchIds = [...new Set(rows.map(r => r.branch_id).filter(Boolean))] as string[]
  if (!branchIds.length) return

  const { data: branches } = await supabase.from('branches').select('id, name').in('id', branchIds)
  const nameMap = new Map((branches ?? []).map(b => [b.id, b.name]))
  for (const row of rows) {
    if (row.branch_id) row.branchName = nameMap.get(row.branch_id) ?? null
  }
}

const OVERDUE_STATUS_FILTER = `(${OVERDUE_TERMINAL_STATUSES.join(',')})`

/** حالات نهائية لا تُعرض في قوائم التكليف (بانتظار / مكلفة / متأخرة) */
const CURRENT_TASK_TERMINAL_FILTER = OVERDUE_STATUS_FILTER

function applyCurrentTaskListFilters(
  q: ReturnType<SupabaseClient['from']> extends infer _ ? any : never,
  options?: FetchCurrentBranchTasksOptions,
) {
  let query = q
  if (options?.debtorIds?.length) query = query.in('id', options.debtorIds)
  if (options?.branchListId) query = query.eq('branch_list_id', options.branchListId)
  if (options?.caseType) query = query.eq('case_type', options.caseType)
  if (options?.taskDefinitionIds?.length) {
    query = query.in('current_task.task_definition_id', options.taskDefinitionIds)
  } else if (options?.taskDefinitionId) {
    query = query.eq('current_task.task_definition_id', options.taskDefinitionId)
  }

  // المعتمدة / المكتملة / المغلقة… لا تُحسب ضمن المهام المكلفة أو بانتظار التكليف
  query = query.not('current_task.task_status', 'in', CURRENT_TASK_TERMINAL_FILTER)

  if (options?.overdue) {
    query = query
      .not('current_task.assigned_to', 'is', null)
      .not('current_task.due_date', 'is', null)
      .lt('current_task.due_date', localTodayYmd())
  } else {
    if (options?.assigned === false) query = query.is('current_task.assigned_to', null)
    if (options?.assigned === true) query = query.not('current_task.assigned_to', 'is', null)
  }
  return query
}

/** Chunked scan — counts only, minimal columns. branchId=null → كل الفروع. */
async function scanCurrentTaskMeta(
  supabase: SupabaseClient,
  branchId: string | null,
  caseType?: 'civil' | 'criminal' | null,
  branchListId?: string | null,
): Promise<CurrentTaskMeta> {
  let unassigned = 0
  let assigned = 0
  const stageCounts = new Map<string, number>()
  const assignedStageCounts = new Map<string, number>()
  const overdueStageCounts = new Map<string, number>()
  const today = localTodayYmd()
  let offset = 0

  while (true) {
    let debtorsQ = supabase
      .from('debtors')
      .select('current_task_id')
      .not('case_status', 'eq', 'closed')
      .not('current_task_id', 'is', null)
      .order('id')
      .range(offset, offset + STATS_CHUNK_SIZE - 1)
    if (branchId) debtorsQ = debtorsQ.eq('branch_id', branchId)
    if (caseType) debtorsQ = debtorsQ.eq('case_type', caseType)
    if (branchListId) debtorsQ = debtorsQ.eq('branch_list_id', branchListId)

    const { data: debtors, error } = await debtorsQ

    if (error) {
      console.error('[scanCurrentTaskMeta:debtors]', error.message ?? error)
      break
    }
    if (!debtors?.length) break

    const taskIds = debtors.map(d => d.current_task_id).filter(Boolean) as string[]
    if (taskIds.length) {
      let tasksQ = supabase
        .from('tasks')
        .select('id, assigned_to, task_definition_id, task_status, due_date')
        .in('id', taskIds)
        .not('task_status', 'in', CURRENT_TASK_TERMINAL_FILTER)
      if (branchId) tasksQ = tasksQ.eq('branch_id', branchId)

      const { data: tasks, error: tErr } = await tasksQ

      if (tErr) {
        console.error('[scanCurrentTaskMeta:tasks]', tErr.message ?? tErr)
      } else {
        for (const task of tasks ?? []) {
          const defId = task.task_definition_id as string | null
          if (taskLawyerId(task)) {
            assigned++
            if (defId) {
              assignedStageCounts.set(defId, (assignedStageCounts.get(defId) ?? 0) + 1)
              const due = task.due_date ? String(task.due_date).slice(0, 10) : ''
              if (due && due < today) {
                overdueStageCounts.set(defId, (overdueStageCounts.get(defId) ?? 0) + 1)
              }
            }
          } else if (defId) {
            // غير مكلفة بتعريف مهمة → بطاقات المراحل
            unassigned++
            stageCounts.set(defId, (stageCounts.get(defId) ?? 0) + 1)
          }
          // بلا task_definition_id → تُحسب ضمن «الأسماء التي تحت إسناد مهمة» لا هنا
        }
      }
    }

    if (debtors.length < STATS_CHUNK_SIZE) break
    offset += STATS_CHUNK_SIZE
  }

  return { unassigned, assigned, stageCounts, assignedStageCounts, overdueStageCounts }
}

async function countCurrentTasksByAssignment(
  supabase: SupabaseClient,
  branchId: string | null,
  assigned: boolean,
  options?: Pick<FetchCurrentBranchTasksOptions, 'debtorIds' | 'taskDefinitionId' | 'taskDefinitionIds' | 'branchListId'>,
): Promise<number> {
  let q = supabase
    .from('debtors')
    .select(`${CURRENT_TASK_EMBED_INNER}`, { count: 'exact', head: true })
    .not('case_status', 'eq', 'closed')
    .not('current_task_id', 'is', null)

  if (branchId) q = q.eq('branch_id', branchId)

  q = applyCurrentTaskListFilters(q, { ...options, assigned })

  const { count, error } = await q
  if (error) {
    console.error('[countCurrentTasksByAssignment]', error.message ?? error)
    return 0
  }
  return count ?? 0
}

async function countOverdueTasks(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: Pick<FetchCurrentBranchTasksOptions, 'debtorIds' | 'taskDefinitionId' | 'taskDefinitionIds' | 'branchListId'>,
): Promise<number> {
  let q = supabase
    .from('debtors')
    .select(`${CURRENT_TASK_EMBED_INNER}`, { count: 'exact', head: true })
    .not('case_status', 'eq', 'closed')
    .not('current_task_id', 'is', null)

  if (branchId) q = q.eq('branch_id', branchId)

  q = applyCurrentTaskListFilters(q, { ...options, overdue: true })

  const { count, error } = await q
  if (error) {
    console.error('[countOverdueTasks]', error.message ?? error)
    return 0
  }
  return count ?? 0
}

export function isUnassignedCurrentTask(row: { lawyerId: string | null }): boolean {
  return !row.lawyerId
}

/**
 * فلتر «المحامي» في تبويب تكليف المهام: مدينون سبق تكليف هذا المحامي بمهامهم
 * (الحقل الحقيقي: tasks.assigned_to) — تُعرض مهامهم الحالية بانتظار التكليف.
 */
export async function resolveDebtorIdsByLawyer(
  supabase: SupabaseClient,
  lawyerId: string,
  branchId: string | null,
): Promise<string[]> {
  let q = supabase
    .from('tasks')
    .select('debtor_id')
    .eq('assigned_to', lawyerId)
    .limit(2000)
  if (branchId) q = q.eq('branch_id', branchId)

  const { data, error } = await q
  if (error) {
    console.error('[resolveDebtorIdsByLawyer]', error.message ?? error)
    return []
  }
  return [...new Set((data ?? []).map(t => t.debtor_id).filter(Boolean))] as string[]
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
  const empty = { rows: [], total: 0, unassignedTotal: 0, assignedTotal: 0, overdueTotal: 0 }

  const limit = options?.limit ?? CURRENT_TASK_PAGE_SIZE
  const offset = options?.offset ?? 0

  const [unassignedTotal, assignedTotal, overdueTotal] = await Promise.all([
    countCurrentTasksByAssignment(supabase, branchId, false, options),
    countCurrentTasksByAssignment(supabase, branchId, true, options),
    countOverdueTasks(supabase, branchId, options),
  ])

  let q = supabase
    .from('debtors')
    .select(CURRENT_TASK_EMBED_INNER, { count: 'exact' })
    .not('case_status', 'eq', 'closed')
    .not('current_task_id', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (branchId) q = q.eq('branch_id', branchId)

  q = applyCurrentTaskListFilters(q, options)

  const { data: debtors, count, error } = await q
  if (error) {
    console.error('[fetchCurrentBranchTaskRowsPaginated]', error.message ?? error)
    return { ...empty, unassignedTotal, assignedTotal, overdueTotal }
  }

  const rows = debtorRowsToTaskRows(debtors ?? [], branchId)
  await Promise.all([
    attachLawyerNames(supabase, rows),
    attachBranchNames(supabase, rows),
  ])

  return {
    rows,
    total: count ?? rows.length,
    unassignedTotal,
    assignedTotal,
    overdueTotal,
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
  const meta = await scanCurrentTaskMeta(supabase, branchId)
  return { unassigned: meta.unassigned, assigned: meta.assigned }
}

/**
 * Combined dashboard load — count/group queries, no full task row fetch.
 * branchId=null → كل الفروع.
 */
export async function fetchDashboardData(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: { caseType?: 'civil' | 'criminal' | null; branchListId?: string | null },
): Promise<{
  stages: UnassignedStageCount[]
  assignedStages: UnassignedStageCount[]
  overdueStages: UnassignedStageCount[]
  unassigned: number
  assigned: number
}> {
  const meta = await scanCurrentTaskMeta(
    supabase,
    branchId,
    options?.caseType ?? null,
    options?.branchListId ?? null,
  )

  const allDefIds = [
    ...new Set([
      ...meta.stageCounts.keys(),
      ...meta.assignedStageCounts.keys(),
      ...meta.overdueStageCounts.keys(),
    ]),
  ]

  const { data: defs } = allDefIds.length
    ? await supabase.from('task_definitions').select('id, label, sort_order').in('id', allDefIds)
    : { data: [] as { id: string; label: string; sort_order: number }[] }

  const defMap = new Map((defs ?? []).map(d => [d.id, d]))

  function buildStages(counts: Map<string, number>): UnassignedStageCount[] {
    const stages: UnassignedStageCount[] = []
    for (const [defId, count] of counts) {
      if (count <= 0) continue
      const def = defMap.get(defId)
      stages.push({
        id: defId,
        label: def?.label ?? '—',
        sortOrder: def?.sort_order ?? 999,
        count,
      })
    }

    if (!branchId && stages.length > 1) {
      const byLabel = new Map<string, UnassignedStageCount>()
      for (const s of stages) {
        const key = s.label.trim().toLowerCase() || s.id
        const prev = byLabel.get(key)
        if (!prev) {
          byLabel.set(key, { ...s })
        } else {
          prev.count += s.count
          if (s.sortOrder < prev.sortOrder) prev.sortOrder = s.sortOrder
        }
      }
      stages.length = 0
      stages.push(...byLabel.values())
    }

    stages.sort((a, b) => a.sortOrder - b.sortOrder)
    return stages
  }

  const stages = buildStages(meta.stageCounts)
  const assignedStages = buildStages(meta.assignedStageCounts)
  const overdueStages = buildStages(meta.overdueStageCounts)

  return {
    stages,
    assignedStages,
    overdueStages,
    unassigned: stages.reduce((sum, s) => sum + s.count, 0),
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
  options?: { caseType?: 'civil' | 'criminal' | null },
): Promise<{ id: string; full_name: string }[]> {
  const { lawyers, error } = await fetchAssignmentLawyers(supabase, branchId, options)
  if (error) {
    console.error('[fetchBranchLawyers]', error)
    return []
  }
  return lawyers
}

/** Validates that a normal lawyer is only assigned tasks from their branch + matching case_type. */
export async function validateLawyerTaskAssignment(
  supabase: SupabaseClient,
  lawyerId: string,
  taskIds: string[],
): Promise<{ ok: boolean; error: string | null }> {
  if (!taskIds.length) return { ok: false, error: 'لا مهام محددة' }

  const [{ data: lawyer }, { data: tasks }] = await Promise.all([
    supabase
      .from('profiles')
      .select('role, branch_id, lawyer_type, case_type')
      .eq('id', lawyerId)
      .single(),
    supabase
      .from('tasks')
      .select('id, branch_id, task_type, debtor_id, task_definitions(task_type), debtors!tasks_debtor_id_fkey(case_type)')
      .in('id', taskIds),
  ])

  if (!lawyer) {
    return { ok: false, error: 'المستخدم غير موجود أو غير صالح' }
  }

  // مندوب: فقط مهام إيجاد عنوان، ونفس فرعه (مسار مدني)
  if (lawyer.role === 'delegate') {
    const delegateBranch = lawyer.branch_id
    if (!delegateBranch) {
      return { ok: false, error: 'المندوب يجب أن يكون مرتبطاً بفرع' }
    }
    for (const t of tasks ?? []) {
      if (t.branch_id && t.branch_id !== delegateBranch) {
        return { ok: false, error: 'لا يمكن تكليف مندوب بمهام من فرع آخر' }
      }
      const defType = Array.isArray(t.task_definitions)
        ? (t.task_definitions[0] as { task_type?: string } | undefined)?.task_type
        : (t.task_definitions as { task_type?: string } | null)?.task_type
      const taskType = t.task_type ?? defType
      if (!isFindAddressTaskType(taskType)) {
        return { ok: false, error: 'يمكن تكليف المندوب بمهمة إيجاد عنوان فقط' }
      }
      const debtorRaw = (t as { debtors?: { case_type?: string } | { case_type?: string }[] | null }).debtors
      const debtorCt = Array.isArray(debtorRaw) ? debtorRaw[0]?.case_type : debtorRaw?.case_type
      if (debtorCt === 'criminal') {
        return { ok: false, error: 'لا يمكن تكليف مندوب بمهام مدين جزائي' }
      }
    }
    return { ok: true, error: null }
  }

  if (lawyer.role !== 'lawyer') {
    return { ok: false, error: 'المحامي غير موجود أو غير صالح' }
  }

  const lawyerCaseType = (lawyer as { case_type?: string }).case_type === 'criminal' ? 'criminal' : 'civil'

  for (const t of tasks ?? []) {
    const debtorRaw = (t as { debtors?: { case_type?: string } | { case_type?: string }[] | null }).debtors
    const debtorCtRaw = Array.isArray(debtorRaw) ? debtorRaw[0]?.case_type : debtorRaw?.case_type
    const debtorCaseType = debtorCtRaw === 'criminal' ? 'criminal' : 'civil'
    if (debtorCaseType !== lawyerCaseType) {
      return {
        ok: false,
        error: lawyerCaseType === 'criminal'
          ? 'لا يمكن تكليف محامٍ جزائي بمهام مدين مدني'
          : 'لا يمكن تكليف محامٍ مدني بمهام مدين جزائي',
      }
    }
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
  // موافقة تلقائية في اليوم التالي لتاريخ التكليف (لا ترتبط بتاريخ نهاية التكليف)
  const expires = endOfLocalDay(localTodayYmd(now))

  return {
    assigned_to: lawyerId,
    task_status: 'assignment_pending_acceptance' as TaskStatus,
    assigned_at: now.toISOString(),
    assignment_expires_at: expires.toISOString(),
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

/** Apply assignment — always assignment_pending_acceptance (no silent skip to assigned).
 * يمنع التكليف المزدوج: يحدّث فقط المهام القابلة للتكليف.
 */
export async function assignTasksToLawyer(
  supabase: SupabaseClient,
  taskIds: string[],
  lawyerId: string,
  dueDate?: string,
  releasedBy?: string,
): Promise<{ ok: boolean; error: string | null }> {
  if (!taskIds.length) return { ok: false, error: 'لا مهام محددة' }

  const ASSIGNABLE = ['waiting_assignment', 'assignment_rejected', 'new', 'draft'] as const

  const full = buildPendingAssignmentPayload(lawyerId, dueDate) as Record<string, unknown>
  // Fallbacks only omit optional columns — never change required status flow
  const payloads: Record<string, unknown>[] = [
    full,
    omitPayloadKeys(full, ['assigned_at']),
    omitPayloadKeys(full, ['assigned_at', 'assignment_expires_at']),
    omitPayloadKeys(full, ['assigned_at', 'assignment_expires_at', 'assignment_rejected_by']),
    {
      assigned_to: lawyerId,
      task_status: 'assignment_pending_acceptance',
      ...(dueDate ? { due_date: dueDate } : {}),
    },
  ]

  let lastError: unknown = null
  for (const payload of payloads) {
    const { data: updated, error } = await supabase
      .from('tasks')
      .update(payload as any)
      .in('id', taskIds)
      .in('task_status', [...ASSIGNABLE])
      .select('id')

    if (error) {
      lastError = error
      continue
    }

    if (!updated?.length) {
      lastError = { message: 'المهمة لم تعد قابلة للتكليف (ربما كُلّفت مسبقاً)' }
      continue
    }

    const { data: check } = await supabase
      .from('tasks')
      .select('id, assigned_to, task_status')
      .in('id', taskIds)
      .limit(1)
    if (
      check?.[0]?.assigned_to === lawyerId
      && check[0].task_status === 'assignment_pending_acceptance'
    ) {
      return { ok: true, error: null }
    }
    lastError = { message: 'فشل حفظ حالة بانتظار القبول — لم يُغيَّر سير العمل' }
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
    // مرفوضة = رفض إنجاز (needs_revision/rejected) للمهام المسندة
    // عدّ رفض التكليف يُضاف في العدادات فقط عبر fetchLawyerTaskStatusCounts
    q = q.eq('assigned_to', lawyerId).in('task_status', ['needs_revision', 'rejected'])
  } else if (status && status !== 'all') {
    q = q.eq('assigned_to', lawyerId)
    if (status === 'completed') {
      q = q.in('task_status', ['approved', 'completed'])
    } else {
      q = q.eq('task_status', status)
    }
  } else {
    // الكل / الرئيسية — المكلف بها فقط
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
  // لا تُنفَّذ كتابات auto-accept عند كل قراءة — الصيانة عبر scheduleBranchMaintenance فقط

  let { data: tasks, count, error } = await queryLawyerTasksPage(supabase, lawyerId, options, true)
  if (error && isMissingAssignmentRejectionColumn(error)) {
    ;({ data: tasks, count, error } = await queryLawyerTasksPage(supabase, lawyerId, options, false))
  }
  if (error) {
    console.error('[fetchLawyerAssignedTasksPaginated]', error.message ?? error)
    return { tasks: [], total: 0, error }
  }
  if (!tasks?.length) return { tasks: [], total: count ?? 0, error: null }

  const rawTasks = tasks as unknown as LawyerTaskListRaw[]
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

    // مصدر الحقيقة لرفض الإنجاز: needs_revision (+ rejected للتوافق)
    const completionRejectedCount = () =>
      baseAssigned().in('task_status', ['needs_revision', 'rejected'])

    const allQuery = baseAssigned()

    const [allRes, completedRes, rejectedAssignRes, rejectedCompletionRes, ...statusRes] = await Promise.all([
      allQuery,
      baseAssigned().in('task_status', ['approved', 'completed']),
      trackAssignmentRejections ? rejectedAssignmentCount() : Promise.resolve({ count: 0, error: null }),
      completionRejectedCount(),
      ...statuses.map(s => baseAssigned().eq('task_status', s)),
    ])

    return { allRes, completedRes, rejectedAssignRes, rejectedCompletionRes, statusRes }
  }

  let { allRes, completedRes, rejectedAssignRes, rejectedCompletionRes, statusRes } = await loadCounts(true)
  const allErr = (allRes as { error?: unknown }).error
  if (allErr && isMissingAssignmentRejectionColumn(allErr)) {
    ;({ allRes, completedRes, rejectedAssignRes, rejectedCompletionRes, statusRes } = await loadCounts(false))
  }

  const counts: LawyerTaskStatusCounts = {
    all: allRes.count ?? 0,
    assignment_pending_acceptance: statusRes[0].count ?? 0,
    assigned: statusRes[1].count ?? 0,
    in_progress: statusRes[2].count ?? 0,
    submitted: statusRes[3].count ?? 0,
    rejected: (rejectedCompletionRes.count ?? 0) + (rejectedAssignRes.count ?? 0),
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
  const nowIso = new Date().toISOString()
  const today = localTodayYmd()

  let q = supabase
    .from('tasks')
    .select('id, assigned_at, assignment_expires_at')
    .eq('task_status', 'assignment_pending_acceptance')

  if (filters?.branchId) q = (q as any).eq('branch_id', filters.branchId)
  if (filters?.lawyerId) q = (q as any).eq('assigned_to', filters.lawyerId)

  const { data: pending } = await q.limit(500)
  if (!pending?.length) return 0

  // يوم تقويمي واحد بعد تاريخ التكليف → مكلفة (موافقة تلقائية)
  const ids = pending
    .filter((t: { assigned_at?: string | null; assignment_expires_at?: string | null }) => {
      if (t.assignment_expires_at && t.assignment_expires_at < nowIso) return true
      if (t.assigned_at) {
        return localTodayYmd(new Date(t.assigned_at)) < today
      }
      return false
    })
    .map((t: { id: string }) => t.id)

  if (!ids.length) return 0

  await supabase
    .from('tasks')
    .update({
      task_status: 'assigned',
      accepted_at: nowIso,
      acceptance_method: 'auto',
    } as any)
    .in('id', ids)
    .eq('task_status', 'assignment_pending_acceptance')

  return ids.length
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

/** حالات يمكن إرجاعها من «مكلفة» إلى «بانتظار التكليف» */
export const UNASSIGNABLE_TASK_STATUSES = [
  'assignment_pending_acceptance',
  'assigned',
  'in_progress',
  'needs_revision',
  'rejected',
  'submitted',
  'pending_review',
] as const

export type UnassignableTaskStatus = (typeof UNASSIGNABLE_TASK_STATUSES)[number]

const UNASSIGN_BLOCKED_FEE = new Set([
  'approved_pending_next',
  'payable',
  'released',
  'paid',
  'withdrawn',
])

function buildUnassignPayload(reason: string | null) {
  const now = new Date().toISOString()
  const trimmed = reason?.trim() || 'إلغاء تكليف من الإدارة'
  return {
    task_status: 'waiting_assignment' as TaskStatus,
    assigned_to: null,
    assigned_at: null,
    assignment_expires_at: null,
    accepted_at: null,
    acceptance_method: null,
    assignment_rejected_by: null,
    due_date: null,
    completed_at: null,
    completion_data: null,
    given_up_at: now,
    give_up_reason: trimmed,
  }
}

/**
 * إلغاء تكليف مهام مكلفة → بانتظار التكليف.
 * تُحذف من قائمة المحامي/المندوب (assigned_to = null) وتبقى current_task_id كما هي.
 * لا يُسمح إن كانت الأتعاب في مسار الاعتماد/الصرف.
 */
export async function unassignTasksToWaiting(
  supabase: SupabaseClient,
  taskIds: string[],
  options?: { reason?: string | null },
): Promise<{ ok: boolean; error: string | null; updatedIds: string[] }> {
  const uniqueIds = [...new Set(taskIds.map(String).filter(Boolean))]
  if (!uniqueIds.length) return { ok: false, error: 'لا مهام محددة', updatedIds: [] }

  let rows: {
    id: string
    task_status: string
    assigned_to: string | null
    fee_status?: string | null
    delegate_fee_status?: string | null
  }[] | null = null

  {
    const fullSel = await supabase
      .from('tasks')
      .select('id, task_status, assigned_to, fee_status, delegate_fee_status')
      .in('id', uniqueIds)
    if (fullSel.error && /fee_status|delegate_fee_status/i.test(fullSel.error.message ?? '')) {
      const basic = await supabase
        .from('tasks')
        .select('id, task_status, assigned_to')
        .in('id', uniqueIds)
      if (basic.error) {
        return { ok: false, error: basic.error.message || 'تعذر قراءة المهام', updatedIds: [] }
      }
      rows = basic.data as typeof rows
    } else if (fullSel.error) {
      return { ok: false, error: fullSel.error.message || 'تعذر قراءة المهام', updatedIds: [] }
    } else {
      rows = fullSel.data as typeof rows
    }
  }

  const found = new Map((rows ?? []).map(r => [r.id as string, r]))
  for (const id of uniqueIds) {
    const row = found.get(id)
    if (!row) {
      return { ok: false, error: 'بعض المهام غير موجودة', updatedIds: [] }
    }
    if (!row.assigned_to) {
      return { ok: false, error: 'بعض المهام غير مكلفة أصلاً', updatedIds: [] }
    }
    const status = String(row.task_status ?? '')
    if (!(UNASSIGNABLE_TASK_STATUSES as readonly string[]).includes(status)) {
      return {
        ok: false,
        error: status === 'approved' || status === 'completed'
          ? 'لا يمكن إلغاء تكليف مهمة معتمدة أو مكتملة'
          : `لا يمكن إلغاء تكليف مهمة بحالة «${status}»`,
        updatedIds: [],
      }
    }
    const fee = row.fee_status ? String(row.fee_status) : null
    if (fee && UNASSIGN_BLOCKED_FEE.has(fee)) {
      return {
        ok: false,
        error: 'لا يمكن إلغاء تكليف مهمة دخلت مسار احتساب/صرف الأتعاب',
        updatedIds: [],
      }
    }
    const dFee = row.delegate_fee_status ? String(row.delegate_fee_status) : null
    if (dFee === 'available' || dFee === 'withdrawn') {
      return {
        ok: false,
        error: 'لا يمكن إلغاء تكليف مهمة مندوب بعد احتساب أتعابه',
        updatedIds: [],
      }
    }
  }

  const full = buildUnassignPayload(options?.reason ?? null) as Record<string, unknown>
  const payloads: Record<string, unknown>[] = [
    full,
    omitPayloadKeys(full, ['accepted_at']),
    omitPayloadKeys(full, ['accepted_at', 'acceptance_method']),
    omitPayloadKeys(full, ['accepted_at', 'acceptance_method', 'assignment_rejected_by']),
    omitPayloadKeys(full, ['accepted_at', 'acceptance_method', 'assignment_rejected_by', 'completion_data']),
    omitPayloadKeys(full, [
      'accepted_at',
      'acceptance_method',
      'assignment_rejected_by',
      'completion_data',
      'given_up_at',
      'give_up_reason',
    ]),
    {
      task_status: 'waiting_assignment',
      assigned_to: null,
      due_date: null,
    },
  ]

  let lastError: unknown = null
  for (const payload of payloads) {
    const { data: updated, error } = await supabase
      .from('tasks')
      .update(payload as any)
      .in('id', uniqueIds)
      .in('task_status', [...UNASSIGNABLE_TASK_STATUSES])
      .not('assigned_to', 'is', null)
      .select('id')

    if (error) {
      lastError = error
      continue
    }

    const updatedIds = (updated ?? []).map(r => r.id as string)
    if (updatedIds.length !== uniqueIds.length) {
      return {
        ok: false,
        error: 'تعذر إلغاء تكليف كل المهام — ربما تغيّرت حالتها. حدّث الصفحة وحاول مجدداً',
        updatedIds,
      }
    }
    return { ok: true, error: null, updatedIds }
  }

  return {
    ok: false,
    error: formatErrorMessage(lastError) || 'فشل إلغاء التكليف',
    updatedIds: [],
  }
}
