import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskStatus } from '@/lib/types'
import { fetchBranchProfiles, toLawyerOptions } from '@/lib/branch-profiles'
import { formatErrorMessage } from '@/lib/format-error'

export interface CurrentBranchTaskRow {
  id: string
  task_status: string
  created_at: string
  due_date: string | null
  debtor_id: string
  task_definition_id: string | null
  task_type: string | null
  branch_id: string | null
  lawyerId: string | null
  debtorName: string
  debtorPhone: string | null
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

/**
 * Single source for dashboard «بانتظار المراجعة» + /admin/tasks/review.
 * No embed joins — avoids silent empty lists when RLS/columns break relations.
 */
export async function fetchPendingReviewTasks(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<PendingReviewTask[]> {
  if (!branchId) return []

  const { data: rawTasks, error } = await supabase
    .from('tasks')
    .select('*')
    .in('task_status', [...REVIEW_QUEUE_STATUSES])
    .not('assigned_to', 'is', null)
    .not('debtor_id', 'is', null)
    .order('completed_at', { ascending: true, nullsFirst: false })

  if (error) {
    console.error('[fetchPendingReviewTasks]', error.message ?? error)
    return []
  }
  if (!rawTasks?.length) return []

  const debtorIds = [...new Set(rawTasks.map(t => t.debtor_id))]
  const { data: debtors } = await supabase
    .from('debtors')
    .select('id, full_name, phone, governorate, case_status, branch_id')
    .in('id', debtorIds)
    .not('case_status', 'eq', 'closed')

  const debtorMap = new Map((debtors ?? []).map(d => [d.id, d]))

  const branchTasks = rawTasks.filter(t => {
    const d = debtorMap.get(t.debtor_id)
    return d && taskBelongsToBranch(t, d, branchId)
  })

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
  const courtMap = new Map((courts ?? []).map((c: { id: string; name: string }) => [c.id, c]))

  return branchTasks.map(t => {
    const d = debtorMap.get(t.debtor_id)!
    const lawyer = t.assigned_to ? lawyerMap.get(t.assigned_to) : null
    const def = t.task_definition_id ? defMap.get(t.task_definition_id) : null
    const court = t.court_id ? courtMap.get(t.court_id) : null
    return {
      ...t,
      debtors: d,
      lawyer: lawyer ? { id: lawyer.id, full_name: lawyer.full_name } : null,
      task_definitions: def ? { id: def.id, label: def.label } : null,
      courts: court ? { name: court.name } : null,
    } as PendingReviewTask
  })
}

/** Hero metric — same filter as review page list. */
export async function fetchPendingReviewCount(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<number> {
  const tasks = await fetchPendingReviewTasks(supabase, branchId)
  return tasks.length
}

export interface UnassignedStageCount {
  id: string
  label: string
  sortOrder: number
  count: number
}

export function isUnassignedCurrentTask(row: { lawyerId: string | null }): boolean {
  return !row.lawyerId
}

/** Stage boxes: unassigned current tasks grouped by task_definition_id. */
export async function fetchUnassignedStageCounts(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<UnassignedStageCount[]> {
  if (!branchId) return []

  const rows = (await fetchCurrentBranchTaskRows(supabase, branchId)).filter(isUnassignedCurrentTask)
  if (!rows.length) return []

  const defIds = [...new Set(rows.map(r => r.task_definition_id).filter(Boolean))] as string[]
  const { data: defs } = defIds.length
    ? await supabase.from('task_definitions').select('id, label, sort_order').in('id', defIds)
    : { data: [] as { id: string; label: string; sort_order: number }[] }

  const defMap = new Map((defs ?? []).map(d => [d.id, d]))
  const stageMap = new Map<string, UnassignedStageCount>()

  for (const r of rows) {
    if (!r.task_definition_id) continue
    const def = defMap.get(r.task_definition_id)
    if (!stageMap.has(r.task_definition_id)) {
      stageMap.set(r.task_definition_id, {
        id: r.task_definition_id,
        label: def?.label ?? r.taskLabel,
        sortOrder: def?.sort_order ?? 999,
        count: 0,
      })
    }
    stageMap.get(r.task_definition_id)!.count++
  }

  return Array.from(stageMap.values())
    .filter(s => s.count > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * Single source of truth for dashboard hero + /admin/tasks.
 */
export async function fetchCurrentBranchTaskRows(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<CurrentBranchTaskRow[]> {
  if (!branchId) return []

  const { data: debtors, error: dErr } = await supabase
    .from('debtors')
    .select(`
      id,
      full_name,
      phone,
      current_task_id,
      case_status,
      current_task:tasks!current_task_id(
        id,
        task_status,
        created_at,
        due_date,
        debtor_id,
        task_definition_id,
        task_type,
        assigned_to,
        branch_id,
        task_definitions(id, label)
      )
    `)
    .eq('branch_id', branchId)
    .not('case_status', 'eq', 'closed')
    .not('current_task_id', 'is', null)

  if (dErr) {
    console.error('[fetchCurrentBranchTaskRows] debtors:', dErr.message ?? dErr.code ?? dErr)
    return []
  }
  if (!debtors?.length) return []

  const rows: CurrentBranchTaskRow[] = []

  for (const d of debtors as any[]) {
    const task = d.current_task
    if (!task?.id || d.current_task_id !== task.id) continue
    if (!taskMatchesBranch(task, branchId)) continue

    const defLabel = task.task_definitions?.label ?? null
    rows.push({
      id: task.id,
      task_status: task.task_status,
      created_at: task.created_at,
      due_date: task.due_date,
      debtor_id: d.id,
      task_definition_id: task.task_definition_id,
      task_type: task.task_type,
      branch_id: task.branch_id,
      lawyerId: taskLawyerId(task),
      debtorName: d.full_name,
      debtorPhone: d.phone ?? null,
      taskLabel: defLabel ?? task.task_type ?? '—',
    })
  }

  return rows
}

export async function fetchCurrentTaskStats(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<{ unassigned: number; assigned: number }> {
  const rows = await fetchCurrentBranchTaskRows(supabase, branchId)
  return {
    unassigned: rows.filter(r => !r.lawyerId).length,
    assigned: rows.filter(r => !!r.lawyerId).length,
  }
}

export async function fetchUnassignedCurrentTasks(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<CurrentBranchTaskRow[]> {
  const rows = await fetchCurrentBranchTaskRows(supabase, branchId)
  return rows.filter(r => !r.lawyerId).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function fetchBranchLawyers(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<{ id: string; full_name: string }[]> {
  const { profiles, error } = await fetchBranchProfiles(supabase, branchId)
  if (error) {
    console.error('[fetchBranchLawyers]', error)
    return []
  }
  return toLawyerOptions(profiles)
}

export function buildPendingAssignmentPayload(lawyerId: string, dueDate?: string) {
  const now = new Date()
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return {
    assigned_to: lawyerId,
    task_status: 'assignment_pending_acceptance' as TaskStatus,
    assigned_at: now.toISOString(),
    assignment_expires_at: expires.toISOString(),
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

/** Lawyer task list — separate debtor fetch avoids embed/RLS join failures. */
export async function fetchLawyerAssignedTasks(
  supabase: SupabaseClient,
  lawyerId: string,
) {
  await autoAcceptExpiredAssignments(supabase, { lawyerId })

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, task_type, task_status, due_date, court_name, governorate, created_at, debtor_id, assignment_expires_at, admin_notes, assigned_to, reward_amount')
    .eq('assigned_to', lawyerId)
    .not('task_status', 'eq', 'draft')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[fetchLawyerAssignedTasks]', error.message ?? error)
    return { tasks: [] as LawyerTaskRow[], error }
  }
  if (!tasks?.length) return { tasks: [] as LawyerTaskRow[], error: null }

  const debtorIds = [...new Set(tasks.map(t => t.debtor_id))]
  const { data: debtors } = await supabase
    .from('debtors')
    .select('id, full_name, governorate, remaining_amount, phone')
    .in('id', debtorIds)

  const debtorMap = new Map((debtors ?? []).map(d => [d.id, d]))

  return {
    tasks: tasks.map(t => ({
      ...t,
      debtors: debtorMap.get(t.debtor_id) ?? null,
    })) as LawyerTaskRow[],
    error: null,
  }
}

export interface LawyerTaskRow {
  id: string
  task_type: string
  task_status: string
  due_date: string | null
  court_name: string | null
  governorate: string | null
  created_at: string
  debtor_id: string
  assignment_expires_at?: string | null
  admin_notes?: string | null
  assigned_to: string | null
  reward_amount?: number | null
  debtors: {
    full_name: string
    governorate?: string | null
    remaining_amount?: number | null
    phone?: string | null
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

  for (const task of expired) {
    await supabase
      .from('tasks')
      .update({
        task_status: 'assigned',
        accepted_at: task.assignment_expires_at ?? now,
        acceptance_method: 'auto',
      } as any)
      .eq('id', task.id)
  }
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
) {
  return supabase
    .from('tasks')
    .update({
      task_status: 'waiting_assignment',
      assigned_to: null,
      assigned_at: null,
      assignment_expires_at: null,
      acceptance_method: null,
      give_up_reason: reason.trim(),
    } as any)
    .eq('id', taskId)
    .eq('task_status', 'assignment_pending_acceptance')
}
