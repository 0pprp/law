import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingHybridSchema } from '@/lib/hybrid-task-links'
import {
  isNotificationDefinition,
  isPleadingDefinition,
  isPleadingTask,
  pickNotificationDefinition,
  pickPleadingDefinition,
} from '@/lib/default-next-task'
import { OVERDUE_TERMINAL_STATUSES, isTaskOverdue } from '@/lib/local-date'

function unwrapTask<T>(raw: T | T[] | null | undefined): T | null {
  if (!raw) return null
  return Array.isArray(raw) ? (raw[0] ?? null) : raw
}

type AdminClient = { from: (table: string) => any }

export const PLEADING_TWIN_MARKER = 'pleading_notification'
export const PLEADING_TWIN_KEY = '_stage_twin'
export const PLEADING_PARENT_KEY = '_pleading_task_id'

const TWIN_ACTIVE_STATUSES = [
  'waiting_assignment',
  'new',
  'draft',
  'assignment_pending_acceptance',
  'assigned',
  'in_progress',
  'submitted',
  'pending_review',
  'needs_info',
  'needs_revision',
  'postponed',
] as const

const TERMINAL_FILTER = `(${OVERDUE_TERMINAL_STATUSES.join(',')})`

export type TwinTaskRow = {
  id: string
  debtor_id: string
  branch_id: string | null
  assigned_to: string | null
  task_status: string
  due_date: string | null
  task_definition_id: string | null
  task_type?: string | null
  hybrid_parent_task_id?: string | null
  created_at?: string | null
  completion_data?: Record<string, unknown> | null
}

function twinCompletion(pleadingTaskId: string): Record<string, string> {
  return {
    [PLEADING_TWIN_KEY]: PLEADING_TWIN_MARKER,
    [PLEADING_PARENT_KEY]: pleadingTaskId,
  }
}

function isStageTwin(row: {
  hybrid_parent_task_id?: string | null
  task_status?: string | null
  task_type?: string | null
  completion_data?: Record<string, unknown> | null
}): boolean {
  const data = row.completion_data ?? {}
  if (data[PLEADING_TWIN_KEY] === PLEADING_TWIN_MARKER) return true
  if (!row.hybrid_parent_task_id) return false
  const st = String(row.task_status ?? '')
  if (['submitted', 'pending_review'].includes(st)) return false
  return (TWIN_ACTIVE_STATUSES as readonly string[]).includes(st)
}

function isNotifTwin(row: TwinTaskRow): boolean {
  if (row.task_type === 'notification') return true
  return isNotificationDefinition({
    task_type: row.task_type,
    label: null,
  })
}

const TWIN_SELECT =
  'id, debtor_id, branch_id, assigned_to, task_status, due_date, task_definition_id, task_type, hybrid_parent_task_id, created_at, completion_data'

function parentIdOfTwin(row: TwinTaskRow): string | null {
  if (row.hybrid_parent_task_id) return String(row.hybrid_parent_task_id)
  const data = row.completion_data ?? {}
  const fromData = data[PLEADING_PARENT_KEY]
  return typeof fromData === 'string' && fromData ? fromData : null
}

async function resolveNotificationDef(
  admin: AdminClient,
  opts: { branchId: string | null; caseType: string | null },
): Promise<{ id: string; label: string; task_type: string | null; fee_amount: number | null } | null> {
  let q = admin
    .from('task_definitions')
    .select('id, label, task_type, branch_id, case_type, fee_amount')
    .eq('is_active', true)
    .order('sort_order')
  if (opts.branchId) q = q.eq('branch_id', opts.branchId)
  const caseType = opts.caseType === 'criminal' ? 'criminal' : 'civil'
  q = q.eq('case_type', caseType)

  const { data } = await q
  const picked = pickNotificationDefinition(data ?? [], {
    branchId: opts.branchId,
    caseType,
  })
  if (!picked) return null
  return {
    id: picked.id,
    label: picked.label ?? 'التبليغ',
    task_type: picked.task_type ?? 'notification',
    fee_amount: Number((picked as { fee_amount?: number | null }).fee_amount ?? 0),
  }
}

async function findExistingTwins(
  admin: AdminClient,
  pleadingTaskIds: string[],
  includeTerminal = false,
): Promise<TwinTaskRow[]> {
  const ids = [...new Set(pleadingTaskIds.filter(Boolean))]
  if (!ids.length) return []

  const out: TwinTaskRow[] = []
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const statuses = includeTerminal
      ? [...TWIN_ACTIVE_STATUSES, ...OVERDUE_TERMINAL_STATUSES]
      : [...TWIN_ACTIVE_STATUSES]
    const withHybrid = await admin
      .from('tasks')
      .select(TWIN_SELECT)
      .in('hybrid_parent_task_id', chunk)
      .in('task_status', statuses)

    if (withHybrid.error && isMissingHybridSchema(withHybrid.error.message)) {
      break
    }
    if (withHybrid.error) {
      console.warn('[pleading-twin:find]', withHybrid.error.message)
      break
    }
    for (const row of withHybrid.data ?? []) {
      if (isStageTwin(row)) out.push(row as TwinTaskRow)
    }
  }
  return out
}

async function findTwinsByDebtorsFallback(
  admin: AdminClient,
  debtorIds: string[],
  pleadingTaskIds: string[],
): Promise<TwinTaskRow[]> {
  const ids = [...new Set(debtorIds.filter(Boolean))]
  const parentSet = new Set(pleadingTaskIds)
  if (!ids.length) return []
  const out: TwinTaskRow[] = []
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data, error } = await admin
      .from('tasks')
      .select(TWIN_SELECT)
      .in('debtor_id', chunk)
      .in('task_status', [...TWIN_ACTIVE_STATUSES])
    if (error) {
      console.warn('[pleading-twin:fallback]', error.message)
      continue
    }
    for (const row of data ?? []) {
      const parent = parentIdOfTwin(row as TwinTaskRow)
      if (parent && parentSet.has(parent) && isStageTwin(row as TwinTaskRow)) out.push(row as TwinTaskRow)
    }
  }
  return out
}

export async function listTwinsForPleadings(
  admin: AdminClient,
  pleadingTaskIds: string[],
  debtorIds?: string[],
  includeTerminal = false,
): Promise<TwinTaskRow[]> {
  const hybrid = await findExistingTwins(admin, pleadingTaskIds, includeTerminal)
  const foundParents = new Set(hybrid.map(t => parentIdOfTwin(t)).filter(Boolean) as string[])
  const missing = pleadingTaskIds.filter(id => !foundParents.has(id))
  if (missing.length && debtorIds?.length) {
    const fallback = await findTwinsByDebtorsFallback(admin, debtorIds, missing)
    return [...hybrid, ...fallback]
  }
  return hybrid
}

async function findAnyTwinsForPleading(
  admin: AdminClient,
  pleadingTaskId: string,
  debtorId?: string,
): Promise<TwinTaskRow[]> {
  const withHybrid = await admin
    .from('tasks')
    .select(TWIN_SELECT)
    .eq('hybrid_parent_task_id', pleadingTaskId)
    .limit(40)
  if (!withHybrid.error && withHybrid.data?.length) {
    return (withHybrid.data as TwinTaskRow[]).filter(t => isStageTwin(t))
  }
  if (!debtorId) return []
  const { data } = await admin
    .from('tasks')
    .select(TWIN_SELECT)
    .eq('debtor_id', debtorId)
    .limit(80)
  return ((data ?? []) as TwinTaskRow[]).filter(t => parentIdOfTwin(t) === pleadingTaskId && isStageTwin(t))
}

type PleadingTaskInput = {
  id: string
  debtor_id: string
  branch_id?: string | null
  due_date?: string | null
}

/**
 * يضمن وجود مهمة تبليغ توأم لمرافعات بانتظار التكليف.
 * لا تُجعل current_task — المرافعات تبقى المهمة الحالية حتى التكليف منها.
 */
export async function ensurePleadingNotificationTwin(
  admin: AdminClient,
  pleading: PleadingTaskInput,
  opts?: { caseType?: string | null; hearingDate?: string | null; createdBy?: string | null },
): Promise<{ ok: boolean; twinId: string | null; error?: string }> {
  if (!pleading.id || !pleading.debtor_id) {
    return { ok: false, twinId: null, error: 'مهمة المرافعات غير صالحة' }
  }

  const existing = await listTwinsForPleadings(admin, [pleading.id], [pleading.debtor_id])
  const live = existing.find(t =>
    isNotifTwin(t)
    && !OVERDUE_TERMINAL_STATUSES.includes(t.task_status as typeof OVERDUE_TERMINAL_STATUSES[number]),
  )
  if (live) return { ok: true, twinId: live.id }

  const prior = await findAnyTwinsForPleading(admin, pleading.id, pleading.debtor_id)
  const alreadyUsed = prior.find(t =>
    isNotifTwin(t)
    && (Boolean(t.assigned_to) || OVERDUE_TERMINAL_STATUSES.includes(t.task_status as typeof OVERDUE_TERMINAL_STATUSES[number])),
  )
  if (alreadyUsed && alreadyUsed.task_status !== 'closed') {
    return { ok: true, twinId: alreadyUsed.id }
  }

  let caseType = opts?.caseType ?? null
  if (!caseType) {
    const { data: debtor } = await admin
      .from('debtors')
      .select('case_type, first_hearing_date, branch_id')
      .eq('id', pleading.debtor_id)
      .maybeSingle()
    caseType = debtor?.case_type ?? 'civil'
    if (!pleading.branch_id) pleading.branch_id = debtor?.branch_id ?? null
    if (!opts?.hearingDate && debtor?.first_hearing_date) {
      opts = { ...opts, hearingDate: String(debtor.first_hearing_date).slice(0, 10) }
    }
  }

  const def = await resolveNotificationDef(admin, {
    branchId: pleading.branch_id ?? null,
    caseType,
  })
  if (!def) return { ok: true, twinId: null }

  const due = (opts?.hearingDate || pleading.due_date || '').slice(0, 10) || null
  const basePayload: Record<string, unknown> = {
    debtor_id: pleading.debtor_id,
    branch_id: pleading.branch_id ?? null,
    task_definition_id: def.id,
    task_type: def.task_type ?? 'notification',
    task_status: 'waiting_assignment',
    assigned_to: null,
    reward_amount: def.fee_amount ?? 0,
    due_date: due,
    completion_data: twinCompletion(pleading.id),
    created_by: opts?.createdBy ?? null,
  }
  const withParent = { ...basePayload, hybrid_parent_task_id: pleading.id }

  let { data: inserted, error } = await admin
    .from('tasks')
    .insert(withParent as any)
    .select('id')
    .maybeSingle()

  if (error && isMissingHybridSchema(error.message)) {
    ;({ data: inserted, error } = await admin
      .from('tasks')
      .insert(basePayload as any)
      .select('id')
      .maybeSingle())
  }

  if (error || !inserted?.id) {
    console.warn('[pleading-twin:insert]', error?.message)
    return { ok: false, twinId: null, error: error?.message ?? 'فشل إنشاء مهمة التبليغ المرتبطة' }
  }
  return { ok: true, twinId: String(inserted.id) }
}

export type LinkedTwinDef = {
  id: string
  label?: string | null
  task_type?: string | null
  fee_amount?: number | null
}

/**
 * ينشئ مهمة مرتبطة مع المرافعات (مثل نشر جريدة) وتظهر بكاردها
 * بدون تغيير current_task.
 */
export async function ensurePleadingLinkedTwin(
  admin: AdminClient,
  pleading: PleadingTaskInput,
  def: LinkedTwinDef,
  opts?: { hearingDate?: string | null; createdBy?: string | null },
): Promise<{ ok: boolean; twinId: string | null; error?: string }> {
  if (!pleading.id || !pleading.debtor_id || !def?.id) {
    return { ok: false, twinId: null, error: 'المهمة المرتبطة غير صالحة' }
  }

  const existing = await listTwinsForPleadings(admin, [pleading.id], [pleading.debtor_id])
  const live = existing.find(t =>
    t.task_definition_id === def.id
    && !OVERDUE_TERMINAL_STATUSES.includes(t.task_status as typeof OVERDUE_TERMINAL_STATUSES[number]),
  )
  if (live) {
    if (opts?.hearingDate) {
      await admin.from('tasks').update({ due_date: opts.hearingDate }).eq('id', live.id)
    }
    return { ok: true, twinId: live.id }
  }

  if (!pleading.branch_id) {
    const { data: debtor } = await admin
      .from('debtors')
      .select('branch_id')
      .eq('id', pleading.debtor_id)
      .maybeSingle()
    pleading.branch_id = debtor?.branch_id ?? null
  }

  const due = (opts?.hearingDate || pleading.due_date || '').slice(0, 10) || null
  const basePayload: Record<string, unknown> = {
    debtor_id: pleading.debtor_id,
    branch_id: pleading.branch_id ?? null,
    task_definition_id: def.id,
    task_type: def.task_type ?? null,
    task_status: 'waiting_assignment',
    assigned_to: null,
    reward_amount: Number(def.fee_amount) || 0,
    due_date: due,
    completion_data: twinCompletion(pleading.id),
    created_by: opts?.createdBy ?? null,
  }
  const withParent = { ...basePayload, hybrid_parent_task_id: pleading.id }

  let { data: inserted, error } = await admin
    .from('tasks')
    .insert(withParent as any)
    .select('id')
    .maybeSingle()

  if (error && isMissingHybridSchema(error.message)) {
    ;({ data: inserted, error } = await admin
      .from('tasks')
      .insert(basePayload as any)
      .select('id')
      .maybeSingle())
  }

  if (error || !inserted?.id) {
    console.warn('[pleading-twin:linked-insert]', error?.message)
    return { ok: false, twinId: null, error: error?.message ?? 'فشل إنشاء المهمة المرتبطة' }
  }
  return { ok: true, twinId: String(inserted.id) }
}

export async function ensureTwinsForPleadingTasks(
  admin: AdminClient,
  pleadings: PleadingTaskInput[],
  opts?: { caseType?: string | null },
): Promise<void> {
  if (!pleadings.length) return
  const existing = await listTwinsForPleadings(
    admin,
    pleadings.map(p => p.id),
    pleadings.map(p => p.debtor_id),
  )
  const haveNotif = new Set(
    existing.filter(t => isNotifTwin(t)).map(t => parentIdOfTwin(t)).filter(Boolean) as string[],
  )
  const missing = pleadings.filter(p => !haveNotif.has(p.id))
  for (const p of missing) {
    await ensurePleadingNotificationTwin(admin, p, { caseType: opts?.caseType ?? null })
  }
}

type PromoteOpts = {
  branchId: string | null
  caseType?: 'civil' | 'criminal' | null
  branchListId?: string | null
  limit?: number
}

const promoteMutex = new Map<string, Promise<unknown>>()

/**
 * أسماء كارد التبليغ القديمة (المهمة الحالية تبليغ وليست توأماً):
 * تُحوَّل إلى مرافعات كـ current_task، والتبليغ الحالي يصبح توأماً.
 */
export async function promoteStandaloneNotificationsToPleadingDual(
  admin: AdminClient,
  opts: PromoteOpts,
): Promise<{ promoted: number }> {
  const key = `${opts.branchId ?? 'all'}:${opts.branchListId ?? 'all'}`
  const prev = promoteMutex.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const chained = prev.then(() => gate)
  promoteMutex.set(key, chained)
  await prev.catch(() => {})
  try {
    return await doPromoteStandaloneNotifications(admin, opts)
  } finally {
    release()
    if (promoteMutex.get(key) === chained) promoteMutex.delete(key)
  }
}

async function doPromoteStandaloneNotifications(
  admin: AdminClient,
  opts: PromoteOpts,
): Promise<{ promoted: number }> {
  const { data: defs, error: defErr } = await admin
    .from('task_definitions')
    .select('id, label, task_type, branch_id, case_type, fee_amount')
    .eq('is_active', true)
  if (defErr) {
    console.warn('[pleading-twin:promote-defs]', defErr.message)
    return { promoted: 0 }
  }
  const notifDefIds = (defs ?? [])
    .filter((d: { task_type?: string | null; label?: string | null }) => isNotificationDefinition(d))
    .map((d: { id: string }) => d.id)
  const pleadingDefs = (defs ?? []).filter((d: { task_type?: string | null; label?: string | null }) =>
    isPleadingDefinition(d),
  )
  if (!notifDefIds.length || !pleadingDefs.length) return { promoted: 0 }

  const selectWithHybrid = `
      id, branch_id, case_type, first_hearing_date, current_task_id,
      current_task:tasks!current_task_id!inner(
        id, assigned_to, due_date, task_definition_id, task_status, task_type,
        hybrid_parent_task_id, completion_data
      )
    `
  const selectNoHybrid = `
      id, branch_id, case_type, first_hearing_date, current_task_id,
      current_task:tasks!current_task_id!inner(
        id, assigned_to, due_date, task_definition_id, task_status, task_type,
        completion_data
      )
    `

  const buildList = (cols: string) => {
    let q = admin
      .from('debtors')
      .select(cols)
      .not('case_status', 'eq', 'closed')
      .not('current_task_id', 'is', null)
      .is('special_status_id', null)
      .in('current_task.task_definition_id', notifDefIds)
      .is('current_task.assigned_to', null)
      .not('current_task.task_status', 'in', TERMINAL_FILTER)
      .order('id')
      .limit(opts.limit ?? 2000)
    if (opts.branchId) q = q.eq('branch_id', opts.branchId)
    if (opts.caseType) q = q.eq('case_type', opts.caseType)
    if (opts.branchListId) q = q.eq('branch_list_id', opts.branchListId)
    return q
  }

  let { data, error } = await buildList(selectWithHybrid)
  if (error && isMissingHybridSchema(error.message)) {
    ;({ data, error } = await buildList(selectNoHybrid))
  }
  if (error) {
    console.warn('[pleading-twin:promote-list]', error.message)
    return { promoted: 0 }
  }

  type Row = {
    id: string
    branch_id: string | null
    case_type: string | null
    first_hearing_date: string | null
    current_task_id: string | null
    current_task: TwinTaskRow | TwinTaskRow[] | null
  }

  const standalone: { debtor: Row; notif: TwinTaskRow }[] = []
  for (const d of (data ?? []) as Row[]) {
    const t = unwrapTask(d.current_task)
    if (!t?.id || d.current_task_id !== t.id) continue
    if (t.assigned_to) continue
    if (isStageTwin(t)) continue
    if (parentIdOfTwin(t)) continue
    standalone.push({ debtor: d, notif: t })
  }
  if (!standalone.length) return { promoted: 0 }

  const debtorIds = standalone.map(s => s.debtor.id)
  const pleadingDefIds = pleadingDefs.map((d: { id: string }) => d.id)
  const existingByDebtor = new Map<string, string>()
  for (let i = 0; i < debtorIds.length; i += 120) {
    const chunk = debtorIds.slice(i, i + 120)
    const { data: existing } = await admin
      .from('tasks')
      .select('id, debtor_id, assigned_to, task_status, task_definition_id')
      .in('debtor_id', chunk)
      .in('task_definition_id', pleadingDefIds)
      .not('task_status', 'in', TERMINAL_FILTER)
      .limit(2000)
    for (const t of existing ?? []) {
      const prev = existingByDebtor.get(t.debtor_id)
      if (!prev || !t.assigned_to) existingByDebtor.set(t.debtor_id, t.id)
    }
  }

  const toInsert: Record<string, unknown>[] = []
  for (const s of standalone) {
    if (existingByDebtor.has(s.debtor.id)) continue
    const pDef = pickPleadingDefinition(pleadingDefs, {
      branchId: s.debtor.branch_id,
      caseType: s.debtor.case_type,
    })
    if (!pDef) continue
    const due = (
      s.debtor.first_hearing_date
      || s.notif.due_date
      || ''
    ).toString().slice(0, 10) || null
    toInsert.push({
      debtor_id: s.debtor.id,
      branch_id: s.debtor.branch_id,
      task_definition_id: pDef.id,
      task_type: pDef.task_type ?? 'pleading',
      task_status: 'waiting_assignment',
      assigned_to: null,
      reward_amount: Number((pDef as { fee_amount?: number | null }).fee_amount ?? 0),
      due_date: due,
    })
  }

  if (toInsert.length) {
    const { data: inserted, error: insErr } = await admin
      .from('tasks')
      .insert(toInsert as any)
      .select('id, debtor_id')
    if (insErr) {
      console.warn('[pleading-twin:promote-insert]', insErr.message)
      return { promoted: 0 }
    }
    for (const row of inserted ?? []) {
      if (row.id && row.debtor_id) existingByDebtor.set(row.debtor_id, row.id)
    }
  }

  let promoted = 0
  for (const s of standalone) {
    const pleadingId = existingByDebtor.get(s.debtor.id)
    if (!pleadingId) continue
    const { error: linkErr } = await admin
      .from('debtors')
      .update({ current_task_id: pleadingId, case_status: 'active' } as any)
      .eq('id', s.debtor.id)
      .eq('current_task_id', s.notif.id)
    if (linkErr) {
      console.warn('[pleading-twin:promote-link]', linkErr.message)
      continue
    }

    const prev = (s.notif.completion_data ?? {}) as Record<string, unknown>
    const twinPatch: Record<string, unknown> = {
      completion_data: { ...prev, ...twinCompletion(pleadingId) },
      assigned_to: null,
      task_status: 'waiting_assignment',
    }
    const withParent = { ...twinPatch, hybrid_parent_task_id: pleadingId }
    let upd = await admin.from('tasks').update(withParent as any).eq('id', s.notif.id)
    if (upd.error && isMissingHybridSchema(upd.error.message)) {
      upd = await admin.from('tasks').update(twinPatch as any).eq('id', s.notif.id)
    }
    if (upd.error) {
      console.warn('[pleading-twin:promote-twin]', upd.error.message)
      continue
    }
    promoted += 1
  }
  return { promoted }
}

/**
 * ينتهي منطق المهمتين معاً عند التكليف من كارد المرافعات:
 * تُحذف توأم التبليغ غير المكلّفة. المكلّفة تبقى كمهمة تبليغ حقيقية.
 */
export async function endPleadingNotificationDual(
  admin: AdminClient,
  pleadingTaskId: string,
): Promise<void> {
  if (!pleadingTaskId) return
  const twins = await listTwinsForPleadings(admin, [pleadingTaskId])
  const unassignedIds = twins.filter(t => !t.assigned_to).map(t => t.id)
  if (!unassignedIds.length) return
  const { error } = await admin.from('tasks').delete().in('id', unassignedIds)
  if (error) {
    console.warn('[pleading-twin:end-dual]', error.message)
    await admin
      .from('tasks')
      .update({ task_status: 'closed' } as any)
      .in('id', unassignedIds)
      .is('assigned_to', null)
  }
}

export async function endDualForAssignedTasks(
  admin: AdminClient,
  taskIds: string[],
): Promise<void> {
  const ids = [...new Set(taskIds.filter(Boolean))]
  if (!ids.length) return
  const { data } = await admin
    .from('tasks')
    .select('id, task_type, assigned_to, task_definitions(task_type, label)')
    .in('id', ids)
  for (const row of data ?? []) {
    if (!isPleadingTask(row as any)) continue
    await endPleadingNotificationDual(admin, row.id)
  }
}

export async function recreateTwinsAfterUnassign(
  admin: AdminClient,
  taskIds: string[],
): Promise<void> {
  const ids = [...new Set(taskIds.filter(Boolean))]
  if (!ids.length) return
  const { data } = await admin
    .from('tasks')
    .select('id, debtor_id, branch_id, due_date, task_type, assigned_to, task_status, task_definitions(task_type, label)')
    .in('id', ids)
  for (const row of data ?? []) {
    if (!isPleadingTask(row as any)) continue
    if (row.assigned_to) continue
    await ensurePleadingNotificationTwin(admin, {
      id: row.id,
      debtor_id: row.debtor_id,
      branch_id: row.branch_id,
      due_date: row.due_date,
    })
  }
}

/** يحدّث تاريخ استحقاق التوأم + المرافعات عند تأجيل المرافعة */
export async function syncTwinDatesOnPostpone(
  admin: AdminClient,
  debtorId: string,
  newDate: string,
  currentTaskId?: string | null,
): Promise<void> {
  const { data: tasks } = await admin
    .from('tasks')
    .select('id, task_type, assigned_to, task_status, hybrid_parent_task_id, completion_data, task_definitions(task_type, label)')
    .eq('debtor_id', debtorId)
    .in('task_status', [...TWIN_ACTIVE_STATUSES])

  const pleadingIds: string[] = []
  const twinIds: string[] = []
  for (const t of tasks ?? []) {
    if (OVERDUE_TERMINAL_STATUSES.includes(t.task_status as any)) continue
    if (isPleadingTask(t as any)) pleadingIds.push(t.id)
    const parent = parentIdOfTwin(t as TwinTaskRow)
    if (parent || isStageTwin(t as TwinTaskRow)) {
      twinIds.push(t.id)
    }
  }

  if (currentTaskId && !pleadingIds.includes(currentTaskId)) {
    const { data: cur } = await admin
      .from('tasks')
      .select('id, task_type, task_definitions(task_type, label)')
      .eq('id', currentTaskId)
      .maybeSingle()
    if (cur && isPleadingTask(cur as any)) pleadingIds.push(cur.id)
  }

  const ids = [...new Set([...pleadingIds, ...twinIds])]
  if (!ids.length) return
  await admin.from('tasks').update({ due_date: newDate }).in('id', ids)
}

type CurrentPleadingRow = {
  id: string
  debtor_id: string
  branch_id: string | null
  assigned_to: string | null
  due_date: string | null
  task_definition_id: string | null
  task_status: string
}

async function fetchCurrentPleadingRows(
  supabase: SupabaseClient,
  opts: {
    branchId: string | null
    caseType?: 'civil' | 'criminal' | null
    branchListId?: string | null
    unassignedOnly?: boolean
  },
): Promise<CurrentPleadingRow[]> {
  let defsQ = supabase
    .from('task_definitions')
    .select('id, task_type, label, branch_id, case_type')
    .eq('is_active', true)
  if (opts.caseType) defsQ = defsQ.eq('case_type', opts.caseType)
  if (opts.branchId) defsQ = defsQ.eq('branch_id', opts.branchId)
  const { data: defs } = await defsQ
  const pleadingDefIds = (defs ?? [])
    .filter(d => isPleadingDefinition(d))
    .map(d => d.id)
  if (!pleadingDefIds.length) return []

  const rows: CurrentPleadingRow[] = []
  const PAGE = 1000
  let offset = 0
  while (true) {
    let q = supabase
      .from('debtors')
      .select(`
        id, branch_id, current_task_id,
        current_task:tasks!current_task_id!inner(
          id, assigned_to, due_date, task_definition_id, task_status
        )
      `)
      .not('case_status', 'eq', 'closed')
      .not('current_task_id', 'is', null)
      .is('special_status_id', null)
      .in('current_task.task_definition_id', pleadingDefIds)
      .not('current_task.task_status', 'in', TERMINAL_FILTER)
      .range(offset, offset + PAGE - 1)
    if (opts.unassignedOnly) q = q.is('current_task.assigned_to', null)
    if (opts.branchId) q = q.eq('branch_id', opts.branchId)
    if (opts.caseType) q = q.eq('case_type', opts.caseType)
    if (opts.branchListId) q = q.eq('branch_list_id', opts.branchListId)

    const { data, error } = await q
    if (error) {
      console.warn('[pleading-twin:current]', error.message)
      break
    }
    for (const d of data ?? []) {
      const t = unwrapTask(d.current_task as any)
      if (!t?.id || d.current_task_id !== t.id) continue
      rows.push({
        id: t.id,
        debtor_id: d.id,
        branch_id: d.branch_id ?? null,
        assigned_to: t.assigned_to ?? null,
        due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
        task_definition_id: t.task_definition_id ?? null,
        task_status: t.task_status,
      })
    }
    if (!data?.length || data.length < PAGE) break
    offset += PAGE
  }
  return rows
}

function pickNotifDefIdForBranch(
  defs: { id: string; task_type?: string | null; label?: string | null; branch_id?: string | null; case_type?: string | null }[],
  branchId: string | null,
  caseType: string | null,
): string | null {
  return pickNotificationDefinition(defs, { branchId, caseType })?.id ?? null
}

async function fetchAssignedStageTwins(
  supabase: SupabaseClient,
  opts: { branchId: string | null; caseType?: 'civil' | 'criminal' | null },
): Promise<TwinTaskRow[]> {
  let q = supabase
    .from('tasks')
    .select(TWIN_SELECT)
    .not('hybrid_parent_task_id', 'is', null)
    .not('assigned_to', 'is', null)
    .not('task_status', 'in', TERMINAL_FILTER)
    .limit(2000)
  if (opts.branchId) q = q.eq('branch_id', opts.branchId)

  const first = await q
  let rows = (first.data ?? []) as TwinTaskRow[]
  if (first.error && isMissingHybridSchema(first.error.message)) {
    const retry = await supabase
      .from('tasks')
      .select('id, debtor_id, branch_id, assigned_to, task_status, due_date, task_definition_id, task_type, created_at, completion_data')
      .not('assigned_to', 'is', null)
      .not('task_status', 'in', TERMINAL_FILTER)
      .limit(2000)
    rows = ((retry.data ?? []) as TwinTaskRow[]).filter(t => isStageTwin(t))
  } else if (first.error) {
    console.warn('[pleading-twin:assigned]', first.error.message)
    return []
  }

  if (opts.caseType) {
    const debtorIds = [...new Set(rows.map(r => r.debtor_id).filter(Boolean))]
    if (debtorIds.length) {
      const { data: debtors } = await supabase
        .from('debtors')
        .select('id, case_type')
        .in('id', debtorIds)
        .eq('case_type', opts.caseType)
      const allowed = new Set((debtors ?? []).map(d => d.id))
      rows = rows.filter(r => allowed.has(r.debtor_id))
    }
  }

  return rows.filter(t => isStageTwin(t))
}

/**
 * يضيف أسماء المرافعات غير المكلّفة إلى عدّاد كارد التبليغ،
 * والمكلّفة من التوأم إلى كارد التبليغ المكلّف/المتأخر.
 */
export async function mergePleadingNotificationTwinCounts(
  supabase: SupabaseClient,
  meta: {
    unassigned: number
    assigned: number
    stageCounts: Map<string, number>
    assignedStageCounts: Map<string, number>
    overdueStageCounts: Map<string, number>
  },
  opts: { branchId: string | null; caseType?: 'civil' | 'criminal' | null; branchListId?: string | null },
): Promise<void> {
  await promoteStandaloneNotificationsToPleadingDual(supabase, opts).catch((e) =>
    console.warn('[pleading-twin:promote]', e),
  )

  let defsQ = supabase
    .from('task_definitions')
    .select('id, task_type, label, branch_id, case_type')
    .eq('is_active', true)
  if (opts.caseType) defsQ = defsQ.eq('case_type', opts.caseType)
  if (opts.branchId) defsQ = defsQ.eq('branch_id', opts.branchId)
  const { data: defs } = await defsQ
  const notificationDefs = (defs ?? []).filter(d => isNotificationDefinition(d))

  const pleadings = await fetchCurrentPleadingRows(supabase, { ...opts, unassignedOnly: true })
  if (pleadings.length) {
    await ensureTwinsForPleadingTasks(supabase, pleadings, { caseType: opts.caseType ?? null }).catch((e) =>
      console.warn('[pleading-twin:ensure]', e),
    )
  }

  const assignedTwins = await fetchAssignedStageTwins(supabase, opts)

  if (!pleadings.length && !assignedTwins.length) return

  const twins = pleadings.length
    ? await listTwinsForPleadings(
        supabase,
        pleadings.map(p => p.id),
        pleadings.map(p => p.debtor_id),
        true,
      )
    : []
  const twinsByParent = new Map<string, TwinTaskRow[]>()
  for (const t of twins) {
    const parent = parentIdOfTwin(t)
    if (!parent) continue
    const list = twinsByParent.get(parent) ?? []
    list.push(t)
    twinsByParent.set(parent, list)
  }

  const bump = (map: Map<string, number>, id: string | null, n = 1) => {
    if (!id) return
    map.set(id, (map.get(id) ?? 0) + n)
  }

  const bumpTwin = (twin: TwinTaskRow) => {
    const defId = twin.task_definition_id
    if (!defId) return
    const terminal = (OVERDUE_TERMINAL_STATUSES as readonly string[]).includes(twin.task_status)
    if (terminal && twin.task_status !== 'closed') return
    if (twin.assigned_to) {
      bump(meta.assignedStageCounts, defId)
      meta.assigned += 1
      if (isTaskOverdue(twin.due_date ? String(twin.due_date).slice(0, 10) : null)) {
        bump(meta.overdueStageCounts, defId)
      }
    } else if (!terminal) {
      bump(meta.stageCounts, defId)
      meta.unassigned += 1
    }
  }

  const countedTwinIds = new Set<string>()
  for (const p of pleadings) {
    const list = twinsByParent.get(p.id) ?? []
    const notifTwin = list.find(t => isNotifTwin(t))
    if (notificationDefs.length) {
      const fallbackDef = pickNotifDefIdForBranch(
        notificationDefs,
        p.branch_id,
        opts.caseType ?? null,
      )
      const notifDefId = notifTwin?.task_definition_id || fallbackDef
      const twinTerminal = notifTwin
        ? (OVERDUE_TERMINAL_STATUSES as readonly string[]).includes(notifTwin.task_status)
        : false
      if (!(twinTerminal && notifTwin?.task_status !== 'closed')) {
        if (notifTwin?.assigned_to) {
          countedTwinIds.add(notifTwin.id)
          bump(meta.assignedStageCounts, notifDefId)
          meta.assigned += 1
          if (isTaskOverdue(notifTwin.due_date ? String(notifTwin.due_date).slice(0, 10) : null)) {
            bump(meta.overdueStageCounts, notifDefId)
          }
        } else {
          bump(meta.stageCounts, notifDefId)
          meta.unassigned += 1
        }
      }
    }
    for (const twin of list) {
      if (isNotifTwin(twin)) continue
      countedTwinIds.add(twin.id)
      bumpTwin(twin)
    }
  }

  for (const twin of assignedTwins) {
    if (countedTwinIds.has(twin.id)) continue
    countedTwinIds.add(twin.id)
    bumpTwin(twin)
  }
}

export async function fetchUnassignedCurrentPleadings(
  admin: AdminClient,
  opts: {
    branchId: string | null
    caseType: 'civil' | 'criminal'
    search?: string
    pleadingDefIds: string[]
  },
): Promise<CurrentPleadingRow[]> {
  if (!opts.pleadingDefIds.length) return []
  const searchTerm = (opts.search ?? '').trim().replace(/[%_,]/g, '')
  let q = admin
    .from('debtors')
    .select(`
      id, branch_id, current_task_id, full_name,
      current_task:tasks!current_task_id!inner(
        id, assigned_to, due_date, task_definition_id, task_status
      )
    `)
    .not('case_status', 'eq', 'closed')
    .not('current_task_id', 'is', null)
    .is('special_status_id', null)
    .eq('case_type', opts.caseType)
    .in('current_task.task_definition_id', opts.pleadingDefIds)
    .is('current_task.assigned_to', null)
    .not('current_task.task_status', 'in', TERMINAL_FILTER)
    .order('full_name')
    .limit(2000)
  if (opts.branchId) q = q.eq('branch_id', opts.branchId)
  if (searchTerm) q = q.ilike('full_name', `%${searchTerm}%`)

  const { data, error } = await q
  if (error) {
    console.warn('[pleading-twin:unassigned-pleadings]', error.message)
    return []
  }
  const rows: CurrentPleadingRow[] = []
  for (const d of data ?? []) {
    const t = unwrapTask(d.current_task as any)
    if (!t?.id || d.current_task_id !== t.id) continue
    if (t.assigned_to) continue
    rows.push({
      id: t.id,
      debtor_id: d.id,
      branch_id: d.branch_id ?? null,
      assigned_to: null,
      due_date: t.due_date ? String(t.due_date).slice(0, 10) : null,
      task_definition_id: t.task_definition_id ?? null,
      task_status: t.task_status,
    })
  }
  return rows
}
