import type { ReceiptType } from '@/lib/types'
import { resolveDebtorCourtName, resolveExecutionOffice } from '@/lib/awaiting-assignment'
import { fetchLastNotePreviewsByDebtorIds } from '@/lib/debtor-last-notes'
import { isNotificationDefinition, isPleadingDefinition } from '@/lib/default-next-task'
import { extractHearingDateFromCompletion } from '@/lib/hearing-date-from-completion'
import { isTaskOverdue, localTodayYmd, OVERDUE_TERMINAL_STATUSES } from '@/lib/local-date'
import {
  ensureTwinsForPleadingTasks,
  fetchUnassignedCurrentPleadings,
  type TwinTaskRow,
} from '@/lib/pleading-notification-twin'
import { resolveSpecialStatus } from '@/lib/special-statuses'
import { taskLawyerId } from '@/lib/task-assignment'

type AdminClient = { from: (table: string) => any }

export type StageView = 'waiting' | 'assigned' | 'overdue'

export type StageDebtorRow = {
  debtorId: string
  debtorName: string
  taskId: string
  taskStatus: string
  lawyerName: string | null
  lawyerRole: string | null
  phone: string | null
  receiptType: ReceiptType | null
  receiptNumber: string | null
  transactionNumber: string | null
  saleDate: string | null
  remaining: number
  taskCreatedAt: string | null
  dueDate: string | null
  branchId: string | null
  branchName: string | null
  branchListId: string | null
  branchListName: string | null
  courtName: string | null
  executionOffice: string | null
  specialStatusName: string | null
  specialStatusColor: string | null
  firstHearingDate: string | null
  lastNote: string
  isNotificationTwin?: boolean
  receiptsPrepared?: boolean
}

export type FetchStageDebtorsParams = {
  stageId: string
  view: StageView
  branchId: string | null
  offset: number
  limit: number
  search?: string
  caseType?: 'civil' | 'criminal' | null
}

export type FetchStageDebtorsResult = {
  stage: {
    id: string
    label: string
    taskType: string | null
    caseType: 'civil' | 'criminal'
  }
  rows: StageDebtorRow[]
  total: number
  nextOffset: number
  hasMore: boolean
}

const TERMINAL_FILTER = `(${OVERDUE_TERMINAL_STATUSES.join(',')})`

function isMissingReceiptsPreparedColumn(message: string | undefined | null): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return m.includes('receipts_prepared') && (m.includes('column') || m.includes('schema cache'))
}

async function matchingDefinitionIds(
  admin: AdminClient,
  def: { id: string; label: string | null },
  branchId: string | null,
): Promise<string[]> {
  const ids = new Set<string>()
  if (def.label) {
    let q = admin
      .from('task_definitions')
      .select('id')
      .eq('is_active', true)
      .eq('label', def.label)
    if (branchId) q = q.eq('branch_id', branchId)
    const { data } = await q
    for (const row of data ?? []) ids.add(row.id)
  }
  if (!ids.size) {
    if (branchId) return []
    ids.add(def.id)
  }
  return [...ids]
}

function mapDebtorRow(
  d: any,
  task: any,
  branchNames: Map<string, string>,
  extra?: { isNotificationTwin?: boolean },
): StageDebtorRow | null {
  if (!task?.id) return null
  const bl = Array.isArray(d.branch_list) ? d.branch_list[0] : d.branch_list
  const lawyer = Array.isArray(task.lawyer) ? task.lawyer[0] : task.lawyer
  const bId = (d.branch_id ?? task.branch_id ?? null) as string | null
  const ss = resolveSpecialStatus(d.special_status)
  return {
    debtorId: d.id,
    debtorName: d.full_name,
    taskId: task.id,
    taskStatus: task.task_status,
    lawyerName: lawyer?.full_name ?? null,
    lawyerRole: lawyer?.role ?? null,
    phone: d.phone ?? null,
    receiptType: d.receipt_type ?? null,
    receiptNumber: d.receipt_number ?? null,
    transactionNumber: d.transaction_number ?? null,
    saleDate: d.sale_date ? String(d.sale_date).slice(0, 10) : null,
    remaining: Number(d.remaining_amount ?? 0),
    taskCreatedAt: task.created_at ?? null,
    dueDate: task.due_date ? String(task.due_date).slice(0, 10) : null,
    branchId: bId,
    branchName: bId ? branchNames.get(bId) ?? 'فرع' : 'بدون فرع',
    branchListId: d.branch_list_id ?? null,
    branchListName: bl?.name?.trim() ?? null,
    courtName: resolveDebtorCourtName(d),
    executionOffice: resolveExecutionOffice(d.branch_list),
    specialStatusName: ss.name,
    specialStatusColor: ss.color,
    firstHearingDate: d.first_hearing_date ? String(d.first_hearing_date).slice(0, 10) : null,
    lastNote: '—',
    isNotificationTwin: extra?.isNotificationTwin ?? false,
    receiptsPrepared: Boolean(d.receipts_prepared),
  }
}

function matchesView(task: { assigned_to?: string | null; due_date?: string | null }, view: StageView): boolean {
  const assigned = Boolean(taskLawyerId(task))
  if (view === 'waiting') return !assigned
  if (view === 'assigned') return assigned
  const due = task.due_date ? String(task.due_date).slice(0, 10) : null
  return assigned && isTaskOverdue(due)
}

async function attachNotesAndHearing(
  admin: AdminClient,
  rows: StageDebtorRow[],
  isPleadingStage: boolean,
): Promise<void> {
  if (!rows.length) return

  const notePreviews = await fetchLastNotePreviewsByDebtorIds(
    admin as any,
    rows.map(r => r.debtorId),
  )
  for (const row of rows) {
    row.lastNote = notePreviews.get(row.debtorId) ?? '—'
  }

  if (!isPleadingStage) return
  const missing = rows.filter(r => !r.firstHearingDate)
  if (!missing.length) return
  const ids = missing.map(r => r.debtorId)
  const { data: priorTasks } = await admin
    .from('tasks')
    .select('debtor_id, completion_data, created_at')
    .in('debtor_id', ids)
    .eq('task_type', 'file_lawsuit')
    .not('completion_data', 'is', null)
    .order('created_at', { ascending: false })
    .limit(Math.min(ids.length * 2, 400))

  const hearingByDebtor = new Map<string, string>()
  for (const row of priorTasks ?? []) {
    const debtorId = row.debtor_id as string
    if (hearingByDebtor.has(debtorId)) continue
    const ymd = extractHearingDateFromCompletion(
      (row.completion_data ?? null) as Record<string, unknown> | null,
    )
    if (ymd) hearingByDebtor.set(debtorId, ymd)
  }
  for (const row of rows) {
    if (row.firstHearingDate) continue
    const ymd = hearingByDebtor.get(row.debtorId)
    if (ymd) row.firstHearingDate = ymd
  }
  await Promise.all(
    [...hearingByDebtor.entries()].map(([debtorId, ymd]) =>
      admin.from('debtors').update({ first_hearing_date: ymd } as any).eq('id', debtorId),
    ),
  )
}

async function attachTransactionSale(admin: AdminClient, rows: StageDebtorRow[]): Promise<void> {
  if (!rows.length) return
  const { data, error } = await admin
    .from('debtors')
    .select('id, transaction_number, sale_date')
    .in('id', rows.map(r => r.debtorId))
  if (error) return
  const map = new Map<string, { transactionNumber: string | null; saleDate: string | null }>(
    (data ?? []).map((d: { id: string; transaction_number?: string | null; sale_date?: string | null }) => [
      d.id,
      {
        transactionNumber: d.transaction_number ?? null,
        saleDate: d.sale_date ? String(d.sale_date).slice(0, 10) : null,
      },
    ]),
  )
  for (const row of rows) {
    const extra = map.get(row.debtorId)
    row.transactionNumber = extra?.transactionNumber ?? row.transactionNumber ?? null
    row.saleDate = extra?.saleDate ?? row.saleDate ?? null
  }
}

async function fetchTwinOverlayRows(
  admin: AdminClient,
  params: {
    view: StageView
    branchId: string | null
    caseType: 'civil' | 'criminal'
    search?: string
    stageDefIds: string[]
    excludeDebtorIds: Set<string>
    ensureNotification: boolean
  },
): Promise<StageDebtorRow[]> {
  if (params.view === 'waiting' && params.ensureNotification) {
    let pleadingDefsQ = admin
      .from('task_definitions')
      .select('id, task_type, label')
      .eq('is_active', true)
      .eq('case_type', params.caseType)
    if (params.branchId) pleadingDefsQ = pleadingDefsQ.eq('branch_id', params.branchId)
    const { data: pleadingDefs } = await pleadingDefsQ
    const pleadingDefIds = (pleadingDefs ?? [])
      .filter((d: { task_type?: string | null; label?: string | null }) => isPleadingDefinition(d))
      .map((d: { id: string }) => d.id)
    if (pleadingDefIds.length) {
      const unassignedPleadings = await fetchUnassignedCurrentPleadings(admin, {
        branchId: params.branchId,
        caseType: params.caseType,
        search: params.search,
        pleadingDefIds,
      })
      const overlayPleadings = unassignedPleadings.filter(p => !params.excludeDebtorIds.has(p.debtor_id))
      if (overlayPleadings.length) {
        await ensureTwinsForPleadingTasks(admin, overlayPleadings, { caseType: params.caseType })
      }
    }
  }

  let twinQ = admin
    .from('tasks')
    .select(`
      id, debtor_id, branch_id, assigned_to, task_status, due_date, task_definition_id, task_type,
      hybrid_parent_task_id, created_at, completion_data,
      lawyer:profiles!tasks_assigned_to_fkey(full_name, role)
    `)
    .in('task_definition_id', params.stageDefIds)
    .not('task_status', 'in', TERMINAL_FILTER)
  if (params.branchId) twinQ = twinQ.eq('branch_id', params.branchId)
  if (params.view === 'waiting') {
    twinQ = twinQ.is('assigned_to', null)
  } else {
    twinQ = twinQ.not('assigned_to', 'is', null)
  }
  if (params.view === 'overdue') {
    twinQ = twinQ
      .not('due_date', 'is', null)
      .lt('due_date', localTodayYmd())
  }

  const { data: twinRows, error } = await twinQ.limit(2000)
  let rows: TwinTaskRow[] = (twinRows ?? []) as TwinTaskRow[]
  if (error && String(error.message ?? '').includes('hybrid_parent_task_id')) {
    const retry = await admin
      .from('tasks')
      .select(`
        id, debtor_id, branch_id, assigned_to, task_status, due_date, task_definition_id, task_type,
        created_at, completion_data,
        lawyer:profiles!tasks_assigned_to_fkey(full_name, role)
      `)
      .in('task_definition_id', params.stageDefIds)
      .not('task_status', 'in', TERMINAL_FILTER)
      .limit(2000)
    rows = (retry.data ?? []) as TwinTaskRow[]
    if (params.view === 'waiting') rows = rows.filter(t => !t.assigned_to)
    else rows = rows.filter(t => Boolean(t.assigned_to))
  }

  const twinish = rows.filter(t => {
    if (params.excludeDebtorIds.has(t.debtor_id)) return false
    const marked = t.completion_data?.['_stage_twin'] === 'pleading_notification'
    return Boolean(t.hybrid_parent_task_id || marked)
  })

  return hydrateTwinRows(admin, twinish, params.branchId, params.search)
}

async function hydrateTwinRows(
  admin: AdminClient,
  twins: TwinTaskRow[],
  branchId: string | null,
  search?: string,
): Promise<StageDebtorRow[]> {
  if (!twins.length) return []
  const debtorIds = [...new Set(twins.map(t => t.debtor_id))]
  const searchTerm = (search ?? '').trim().replace(/[%_,]/g, '')
  let dq = admin
    .from('debtors')
    .select(`
      id, full_name, phone, receipt_type, receipt_number, first_hearing_date, branch_id, branch_list_id,
      remaining_amount, case_status, current_task_id, receipts_prepared,
      branch_list:branch_lists(name, court_name, execution_office),
      special_status:special_statuses(id, name, color)
    `)
    .in('id', debtorIds)
    .not('case_status', 'eq', 'closed')
    .is('special_status_id', null)
  if (branchId) dq = dq.eq('branch_id', branchId)
  if (searchTerm) dq = dq.ilike('full_name', `%${searchTerm}%`)

  const { data: debtors, error: debtorErr } = await dq
  let debtorRows = debtors ?? []
  if (debtorErr && isMissingReceiptsPreparedColumn(debtorErr.message)) {
    let retry = admin
      .from('debtors')
      .select(`
      id, full_name, phone, receipt_type, receipt_number, first_hearing_date, branch_id, branch_list_id,
      remaining_amount, case_status, current_task_id,
      branch_list:branch_lists(name, court_name, execution_office),
      special_status:special_statuses(id, name, color)
    `)
      .in('id', debtorIds)
      .not('case_status', 'eq', 'closed')
      .is('special_status_id', null)
    if (branchId) retry = retry.eq('branch_id', branchId)
    if (searchTerm) retry = retry.ilike('full_name', `%${searchTerm}%`)
    const { data: fallback } = await retry
    debtorRows = fallback ?? []
  }
  const debtorMap = new Map((debtorRows).map((d: any) => [d.id, d]))

  const branchIds = [...new Set(
    debtorRows.map((d: { branch_id?: string | null }) => d.branch_id).filter(Boolean),
  )] as string[]
  const branchNames = new Map<string, string>()
  if (branchIds.length) {
    const { data: branches } = await admin.from('branches').select('id, name').in('id', branchIds)
    for (const b of branches ?? []) branchNames.set(b.id, b.name)
  }

  const out: StageDebtorRow[] = []
  for (const t of twins) {
    const d = debtorMap.get(t.debtor_id)
    if (!d) continue
    const mapped = mapDebtorRow(d, t, branchNames, { isNotificationTwin: true })
    if (mapped) out.push(mapped)
  }
  return out
}

export async function fetchStageDebtors(
  admin: AdminClient,
  params: FetchStageDebtorsParams,
): Promise<FetchStageDebtorsResult> {
  const { data: def, error: defErr } = await admin
    .from('task_definitions')
    .select('id, label, task_type, case_type')
    .eq('id', params.stageId)
    .maybeSingle()

  if (defErr || !def) {
    throw new Error(defErr?.message ?? 'المرحلة غير موجودة')
  }

  const stageCt = def.case_type === 'criminal' ? 'criminal' as const : 'civil' as const
  const empty: FetchStageDebtorsResult = {
    stage: {
      id: def.id,
      label: def.label ?? '—',
      taskType: def.task_type ?? null,
      caseType: stageCt,
    },
    rows: [],
    total: 0,
    nextOffset: params.offset,
    hasMore: false,
  }

  if (params.caseType && params.caseType !== stageCt) return empty

  const defIds = await matchingDefinitionIds(admin, def, params.branchId)
  if (!defIds.length) return empty

  const searchTerm = (params.search ?? '').trim().replace(/[%_,]/g, '')
  const isNotifStage = isNotificationDefinition(def)
  const isPleadingStage = isPleadingDefinition(def)

  let q: any = admin
    .from('debtors')
    .select(`
      id, full_name, phone, receipt_type, receipt_number, first_hearing_date, branch_id, branch_list_id,
      remaining_amount, case_status, case_type, current_task_id, receipts_prepared,
      branch_list:branch_lists(name, court_name, execution_office),
      special_status:special_statuses(id, name, color),
      current_task:tasks!current_task_id!inner(
        id, task_status, assigned_to, created_at, due_date, task_definition_id, branch_id,
        lawyer:profiles!tasks_assigned_to_fkey(full_name, role)
      )
    `, { count: 'estimated' })
    .not('case_status', 'eq', 'closed')
    .not('current_task_id', 'is', null)
    .is('special_status_id', null)
    .eq('case_type', stageCt)
    .in('current_task.task_definition_id', defIds)
    .not('current_task.task_status', 'in', TERMINAL_FILTER)
    .order('full_name')
    .order('id')
    .range(params.offset, params.offset + params.limit - 1)

  if (params.branchId) q = q.eq('branch_id', params.branchId)
  if (searchTerm) q = q.ilike('full_name', `%${searchTerm}%`)

  if (params.view === 'waiting') {
    q = q.is('current_task.assigned_to', null)
  } else if (params.view === 'assigned') {
    q = q.not('current_task.assigned_to', 'is', null)
  } else {
    q = q
      .not('current_task.assigned_to', 'is', null)
      .not('current_task.due_date', 'is', null)
      .lt('current_task.due_date', localTodayYmd())
  }

  const { data, error, count } = await q
  let rawRows = data ?? []
  let rawCount = count
  if (error && isMissingReceiptsPreparedColumn(error.message)) {
    let retry: any = admin
      .from('debtors')
      .select(`
      id, full_name, phone, receipt_type, receipt_number, first_hearing_date, branch_id, branch_list_id,
      remaining_amount, case_status, case_type, current_task_id,
      branch_list:branch_lists(name, court_name, execution_office),
      special_status:special_statuses(id, name, color),
      current_task:tasks!current_task_id!inner(
        id, task_status, assigned_to, created_at, due_date, task_definition_id, branch_id,
        lawyer:profiles!tasks_assigned_to_fkey(full_name, role)
      )
    `, { count: 'estimated' })
      .not('case_status', 'eq', 'closed')
      .not('current_task_id', 'is', null)
      .is('special_status_id', null)
      .eq('case_type', stageCt)
      .in('current_task.task_definition_id', defIds)
      .not('current_task.task_status', 'in', TERMINAL_FILTER)
      .order('full_name')
      .order('id')
      .range(params.offset, params.offset + params.limit - 1)

    if (params.branchId) retry = retry.eq('branch_id', params.branchId)
    if (searchTerm) retry = retry.ilike('full_name', `%${searchTerm}%`)
    if (params.view === 'waiting') {
      retry = retry.is('current_task.assigned_to', null)
    } else if (params.view === 'assigned') {
      retry = retry.not('current_task.assigned_to', 'is', null)
    } else {
      retry = retry
        .not('current_task.assigned_to', 'is', null)
        .not('current_task.due_date', 'is', null)
        .lt('current_task.due_date', localTodayYmd())
    }
    const fallback = await retry
    if (fallback.error) throw new Error(fallback.error.message || 'فشل تحميل أسماء المرحلة')
    rawRows = fallback.data ?? []
    rawCount = fallback.count
  } else if (error) {
    throw new Error(error.message || 'فشل تحميل أسماء المرحلة')
  }

  const branchIds = [...new Set(rawRows.map((d: { branch_id?: string | null }) => d.branch_id).filter(Boolean))] as string[]
  const branchNames = new Map<string, string>()
  if (branchIds.length) {
    const { data: branches } = await admin.from('branches').select('id, name').in('id', branchIds)
    for (const b of branches ?? []) branchNames.set(b.id, b.name)
  }

  const mapped: StageDebtorRow[] = []
  const seenTaskIds = new Set<string>()
  const seenDebtorIds = new Set<string>()
  for (const d of rawRows) {
    const t = d.current_task
    if (!t || d.current_task_id !== t.id) continue
    if (seenTaskIds.has(t.id)) continue
    if (params.branchId && (t.branch_id ?? d.branch_id) !== params.branchId) continue
    if (!matchesView(t, params.view)) continue
    seenTaskIds.add(t.id)
    seenDebtorIds.add(d.id)
    const row = mapDebtorRow(d, t, branchNames)
    if (row) mapped.push(row)
  }

  let overlay: StageDebtorRow[] = []
  if (params.offset === 0 && !isPleadingStage) {
    overlay = await fetchTwinOverlayRows(admin, {
      view: params.view,
      branchId: params.branchId,
      caseType: stageCt,
      search: searchTerm,
      stageDefIds: defIds,
      excludeDebtorIds: seenDebtorIds,
      ensureNotification: isNotifStage,
    })
    overlay = overlay.filter(r => !seenTaskIds.has(r.taskId))
  }

  const rows = params.offset === 0 ? [...overlay, ...mapped] : mapped
  await attachNotesAndHearing(admin, rows, isPleadingStage)
  await attachTransactionSale(admin, rows)

  const currentTotal = typeof rawCount === 'number' ? rawCount : mapped.length
  const overlayTotal = overlay.length
  const total = currentTotal + overlayTotal
  const nextOffset = params.offset + rawRows.length

  return {
    stage: empty.stage,
    rows,
    total,
    nextOffset,
    hasMore: nextOffset < currentTotal,
  }
}
