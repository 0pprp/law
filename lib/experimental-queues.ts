/**
 * طوابير الآلية الجديدة: الأسماء المضافة مؤخراً (= تحت إسناد مهمة) + أرشيف القانونية.
 * الأرشفة عبر صفة «أرشيف القانونية» لكل فرع.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { countAwaitingAssignmentDebtors, fetchAwaitingAssignmentDebtors } from '@/lib/awaiting-assignment'

export const LEGAL_ARCHIVE_STATUS_NAME = 'أرشيف القانونية'

export type ExperimentalQueue = 'recent' | 'archive'

export type ExperimentalQueueScope = {
  branchId: string | null
  branchListId?: string | null
  caseType?: 'civil' | 'criminal' | null
}

export type ExperimentalDebtorFile = {
  id: string
  file_name: string
  file_path: string
}

export type ExperimentalDebtorRow = {
  id: string
  full_name: string
  phone: string | null
  receipt_number: string | null
  transaction_number: string | null
  sale_date: string | null
  branch_id: string | null
  branch_list_id: string | null
  created_at: string | null
  assignment_note: string | null
  special_status_id: string | null
  amount_owed: number | null
  governorate: string | null
  current_task_id: string | null
  current_task_label: string | null
  primary_file: ExperimentalDebtorFile | null
}

const archiveStatusIdCache = new Map<string, string>()

export async function ensureLegalArchiveStatusId(
  supabase: SupabaseClient,
  branchId: string,
): Promise<string> {
  const cached = archiveStatusIdCache.get(branchId)
  if (cached) return cached

  const { data: existing } = await supabase
    .from('special_statuses')
    .select('id')
    .eq('branch_id', branchId)
    .eq('name', LEGAL_ARCHIVE_STATUS_NAME)
    .maybeSingle()
  if (existing?.id) {
    archiveStatusIdCache.set(branchId, existing.id)
    return existing.id
  }

  const { data: created, error } = await supabase
    .from('special_statuses')
    .insert({
      branch_id: branchId,
      name: LEGAL_ARCHIVE_STATUS_NAME,
      color: 'blue',
      sort_order: 900,
      is_active: true,
    })
    .select('id')
    .single()
  if (error || !created) throw new Error(error?.message ?? 'فشل إنشاء صفة أرشيف القانونية')
  archiveStatusIdCache.set(branchId, created.id)
  return created.id
}

async function listLegalArchiveStatusIds(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<string[]> {
  let q = supabase
    .from('special_statuses')
    .select('id')
    .eq('name', LEGAL_ARCHIVE_STATUS_NAME)
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []).map(s => s.id)
}

async function activeInstantDebtorIds(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<string[]> {
  let q = supabase
    .from('instant_case_nominations')
    .select('debtor_id')
    .in('status', ['pending', 'approved'])
    .not('debtor_id', 'is', null)
  if (branchId) q = q.eq('branch_id', branchId)
  const { data, error } = await q.limit(2000)
  if (error) {
    console.warn('[experimental-queues:instant-ids]', error.message)
    return []
  }
  return [...new Set((data ?? []).map(r => r.debtor_id).filter(Boolean))] as string[]
}

async function countAwaitingForScope(
  supabase: SupabaseClient,
  scope: ExperimentalQueueScope,
): Promise<number> {
  const listId = scope.branchListId?.trim() || null
  const caseType = scope.caseType === 'civil' || scope.caseType === 'criminal' ? scope.caseType : null
  const excludeDebtorIds = await activeInstantDebtorIds(supabase, scope.branchId)
  if (!caseType && listId) {
    const [civil, criminal] = await Promise.all([
      countAwaitingAssignmentDebtors(supabase, scope.branchId, {
        branchListId: listId,
        caseType: 'civil',
        mode: 'awaiting',
        excludeDebtorIds,
      }),
      countAwaitingAssignmentDebtors(supabase, scope.branchId, {
        branchListId: null,
        caseType: 'criminal',
        mode: 'awaiting',
        excludeDebtorIds,
      }),
    ])
    return (civil.error ? 0 : civil.total) + (criminal.error ? 0 : criminal.total)
  }
  const res = await countAwaitingAssignmentDebtors(supabase, scope.branchId, {
    branchListId: listId,
    caseType,
    mode: 'awaiting',
    excludeDebtorIds,
  })
  return res.error ? 0 : res.total
}

function applyArchiveFilters(
  q: any,
  scope: ExperimentalQueueScope,
): any {
  let next = q.not('case_status', 'eq', 'closed')
  if (scope.branchId) next = next.eq('branch_id', scope.branchId)
  if (scope.caseType) next = next.eq('case_type', scope.caseType)
  const listId = scope.branchListId?.trim() || null
  if (listId && scope.caseType !== 'criminal') {
    next = next.eq('branch_list_id', listId)
  }
  return next
}

export async function countExperimentalQueue(
  supabase: SupabaseClient,
  queue: ExperimentalQueue,
  scope: ExperimentalQueueScope,
): Promise<number> {
  if (queue === 'recent') return countAwaitingForScope(supabase, scope)

  if (scope.branchId) {
    await ensureLegalArchiveStatusId(supabase, scope.branchId)
  }
  const statusIds = await listLegalArchiveStatusIds(supabase, scope.branchId)
  if (!statusIds.length) return 0

  let q = supabase.from('debtors').select('id', { count: 'exact', head: true }).in('special_status_id', statusIds)
  q = applyArchiveFilters(q, scope)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function listExperimentalQueue(
  supabase: SupabaseClient,
  queue: ExperimentalQueue,
  scope: ExperimentalQueueScope,
  opts?: { q?: string; limit?: number; offset?: number },
): Promise<ExperimentalDebtorRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200)
  const offset = Math.max(opts?.offset ?? 0, 0)

  if (queue === 'recent') {
    const listId = scope.branchListId?.trim() || null
    const caseType = scope.caseType === 'civil' || scope.caseType === 'criminal' ? scope.caseType : null
    const excludeDebtorIds = await activeInstantDebtorIds(supabase, scope.branchId)
    const fetched = await fetchAwaitingAssignmentDebtors(supabase, scope.branchId, {
      search: opts?.q,
      offset,
      limit,
      branchListId: caseType === 'criminal' ? null : listId,
      caseType,
      mode: 'awaiting',
      excludeDebtorIds,
    })
    if (fetched.error) throw new Error(fetched.error)
    const ids = fetched.rows.map(r => r.id)
    const extraById = new Map<string, {
      phone: string | null
      receipt_number: string | null
      transaction_number: string | null
      sale_date: string | null
      required_amount: number | null
      governorate: string | null
      current_task_id: string | null
    }>()
    if (ids.length) {
      let extraRes: { data: any[] | null; error: { message?: string } | null } = await supabase
        .from('debtors')
        .select('id, phone, receipt_number, transaction_number, sale_date, required_amount, governorate, current_task_id')
        .in('id', ids)
      if (extraRes.error) {
        extraRes = await supabase
          .from('debtors')
          .select('id, phone, receipt_number, required_amount, governorate, current_task_id')
          .in('id', ids)
      }
      for (const row of extraRes.data ?? []) {
        extraById.set(row.id, {
          phone: row.phone ?? null,
          receipt_number: row.receipt_number ?? null,
          transaction_number: (row as { transaction_number?: string | null }).transaction_number ?? null,
          sale_date: (row as { sale_date?: string | null }).sale_date ? String((row as { sale_date?: string | null }).sale_date).slice(0, 10) : null,
          required_amount: row.required_amount != null ? Number(row.required_amount) : null,
          governorate: row.governorate ?? null,
          current_task_id: row.current_task_id ?? null,
        })
      }
    }
    const mapped = fetched.rows.map(r => {
      const extra = extraById.get(r.id)
      return {
        id: r.id,
        full_name: r.full_name,
        phone: extra?.phone ?? null,
        receipt_number: extra?.receipt_number ?? null,
        transaction_number: extra?.transaction_number ?? null,
        sale_date: extra?.sale_date ?? null,
        branch_id: r.branch_id,
        branch_list_id: r.branch_list_id,
        created_at: r.created_at,
        assignment_note: r.assignment_note,
        special_status_id: r.special_status_id ?? null,
        amount_owed: extra?.required_amount ?? null,
        governorate: extra?.governorate ?? null,
        current_task_id: extra?.current_task_id ?? null,
        current_task_label: r.needs_task_definition ? 'تحتاج تعريف مهمة' : null,
        primary_file: null as ExperimentalDebtorFile | null,
      }
    })
    await attachPrimaryFiles(supabase, mapped)
    return mapped
  }

  if (scope.branchId) {
    await ensureLegalArchiveStatusId(supabase, scope.branchId)
  }
  const statusIds = await listLegalArchiveStatusIds(supabase, scope.branchId)
  if (!statusIds.length) return []

  let q = supabase
    .from('debtors')
    .select(
      'id, full_name, phone, receipt_number, transaction_number, sale_date, branch_id, branch_list_id, created_at, assignment_note, special_status_id, required_amount, governorate, current_task_id, current_task:tasks!current_task_id(id, task_definitions(label))',
    )
    .in('special_status_id', statusIds)
    .order('created_at', { ascending: false })
  q = applyArchiveFilters(q, scope)

  const search = opts?.q?.trim()
  if (search) {
    q = q.or(
      `full_name.ilike.%${search}%,phone.ilike.%${search}%,receipt_number.ilike.%${search}%,transaction_number.ilike.%${search}%`,
    )
  }

  let { data, error } = await q.range(offset, offset + limit - 1)
  if (error && (error.message?.includes('transaction_number') || error.code === 'PGRST204' || error.code === '42703')) {
    let fallback = supabase
      .from('debtors')
      .select(
        'id, full_name, phone, receipt_number, branch_id, branch_list_id, created_at, assignment_note, special_status_id, required_amount, governorate, current_task_id, current_task:tasks!current_task_id(id, task_definitions(label))',
      )
      .in('special_status_id', statusIds)
      .order('created_at', { ascending: false })
    fallback = applyArchiveFilters(fallback, scope)
    if (search) {
      fallback = fallback.or(
        `full_name.ilike.%${search}%,phone.ilike.%${search}%,receipt_number.ilike.%${search}%`,
      )
    }
    const retry = await fallback.range(offset, offset + limit - 1)
    data = retry.data as typeof data
    error = retry.error
  }
  if (error) throw new Error(error.message)

  const mapped = (data ?? []).map((d: any) => {
    const task = Array.isArray(d.current_task) ? d.current_task[0] : d.current_task
    const def = Array.isArray(task?.task_definitions) ? task.task_definitions[0] : task?.task_definitions
    return {
      id: d.id,
      full_name: d.full_name,
      phone: d.phone ?? null,
      receipt_number: d.receipt_number ?? null,
      transaction_number: d.transaction_number ?? null,
      sale_date: d.sale_date ? String(d.sale_date).slice(0, 10) : null,
      branch_id: d.branch_id ?? null,
      branch_list_id: d.branch_list_id ?? null,
      created_at: d.created_at ?? null,
      assignment_note: d.assignment_note ?? null,
      special_status_id: d.special_status_id ?? null,
      amount_owed: d.required_amount != null ? Number(d.required_amount) : null,
      governorate: d.governorate ?? null,
      current_task_id: d.current_task_id ?? null,
      current_task_label: def?.label ?? null,
      primary_file: null as ExperimentalDebtorFile | null,
    }
  })
  await attachPrimaryFiles(supabase, mapped)
  return mapped
}

async function attachPrimaryFiles(
  supabase: SupabaseClient,
  rows: ExperimentalDebtorRow[],
): Promise<void> {
  if (!rows.length) return
  const { data } = await supabase
    .from('debtor_attachments')
    .select('id, debtor_id, file_name, file_path, created_at')
    .in('debtor_id', rows.map(r => r.id))
    .order('created_at', { ascending: false })
  const byDebtor = new Map<string, ExperimentalDebtorFile>()
  for (const att of data ?? []) {
    const debtorId = att.debtor_id as string
    if (byDebtor.has(debtorId)) continue
    byDebtor.set(debtorId, {
      id: att.id,
      file_name: att.file_name || 'ملف',
      file_path: att.file_path ?? '',
    })
  }
  for (const row of rows) {
    row.primary_file = byDebtor.get(row.id) ?? null
  }
}
