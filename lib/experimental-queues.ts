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

export type ExperimentalDebtorRow = {
  id: string
  full_name: string
  phone: string | null
  receipt_number: string | null
  branch_id: string | null
  branch_list_id: string | null
  created_at: string | null
  assignment_note: string | null
  special_status_id: string | null
  amount_owed: number | null
  governorate: string | null
  current_task_id: string | null
  current_task_label: string | null
}

export async function ensureLegalArchiveStatusId(
  supabase: SupabaseClient,
  branchId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from('special_statuses')
    .select('id')
    .eq('branch_id', branchId)
    .eq('name', LEGAL_ARCHIVE_STATUS_NAME)
    .maybeSingle()
  if (existing?.id) {
    await supabase
      .from('special_statuses')
      .update({ is_active: true })
      .eq('id', existing.id)
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

async function countAwaitingForScope(
  supabase: SupabaseClient,
  scope: ExperimentalQueueScope,
): Promise<number> {
  const listId = scope.branchListId?.trim() || null
  const caseType = scope.caseType === 'civil' || scope.caseType === 'criminal' ? scope.caseType : null
  if (!caseType && listId) {
    const [civil, criminal] = await Promise.all([
      countAwaitingAssignmentDebtors(supabase, scope.branchId, {
        branchListId: listId,
        caseType: 'civil',
        mode: 'awaiting',
      }),
      countAwaitingAssignmentDebtors(supabase, scope.branchId, {
        branchListId: null,
        caseType: 'criminal',
        mode: 'awaiting',
      }),
    ])
    return (civil.error ? 0 : civil.total) + (criminal.error ? 0 : criminal.total)
  }
  const res = await countAwaitingAssignmentDebtors(supabase, scope.branchId, {
    branchListId: listId,
    caseType,
    mode: 'awaiting',
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
    const fetched = await fetchAwaitingAssignmentDebtors(supabase, scope.branchId, {
      search: opts?.q,
      offset,
      limit,
      branchListId: caseType === 'criminal' ? null : listId,
      caseType,
      mode: 'awaiting',
    })
    if (fetched.error) throw new Error(fetched.error)
    const ids = fetched.rows.map(r => r.id)
    const extraById = new Map<string, { phone: string | null; receipt_number: string | null; required_amount: number | null; governorate: string | null; current_task_id: string | null }>()
    if (ids.length) {
      const { data: extra } = await supabase
        .from('debtors')
        .select('id, phone, receipt_number, required_amount, governorate, current_task_id')
        .in('id', ids)
      for (const row of extra ?? []) {
        extraById.set(row.id, {
          phone: row.phone ?? null,
          receipt_number: row.receipt_number ?? null,
          required_amount: row.required_amount != null ? Number(row.required_amount) : null,
          governorate: row.governorate ?? null,
          current_task_id: row.current_task_id ?? null,
        })
      }
    }
    return fetched.rows.map(r => {
      const extra = extraById.get(r.id)
      return {
        id: r.id,
        full_name: r.full_name,
        phone: extra?.phone ?? null,
        receipt_number: extra?.receipt_number ?? null,
        branch_id: r.branch_id,
        branch_list_id: r.branch_list_id,
        created_at: r.created_at,
        assignment_note: r.assignment_note,
        special_status_id: r.special_status_id ?? null,
        amount_owed: extra?.required_amount ?? null,
        governorate: extra?.governorate ?? null,
        current_task_id: extra?.current_task_id ?? null,
        current_task_label: r.needs_task_definition ? 'تحتاج تعريف مهمة' : null,
      }
    })
  }

  if (scope.branchId) {
    await ensureLegalArchiveStatusId(supabase, scope.branchId)
  }
  const statusIds = await listLegalArchiveStatusIds(supabase, scope.branchId)
  if (!statusIds.length) return []

  let q = supabase
    .from('debtors')
    .select(
      'id, full_name, phone, receipt_number, branch_id, branch_list_id, created_at, assignment_note, special_status_id, required_amount, governorate, current_task_id, current_task:tasks!current_task_id(id, task_definitions(label))',
    )
    .in('special_status_id', statusIds)
    .order('created_at', { ascending: false })
  q = applyArchiveFilters(q, scope)

  const search = opts?.q?.trim()
  if (search) {
    q = q.or(
      `full_name.ilike.%${search}%,phone.ilike.%${search}%,receipt_number.ilike.%${search}%`,
    )
  }

  const { data, error } = await q.range(offset, offset + limit - 1)
  if (error) throw new Error(error.message)

  return (data ?? []).map((d: any) => {
    const task = Array.isArray(d.current_task) ? d.current_task[0] : d.current_task
    const def = Array.isArray(task?.task_definitions) ? task.task_definitions[0] : task?.task_definitions
    return {
      id: d.id,
      full_name: d.full_name,
      phone: d.phone ?? null,
      receipt_number: d.receipt_number ?? null,
      branch_id: d.branch_id ?? null,
      branch_list_id: d.branch_list_id ?? null,
      created_at: d.created_at ?? null,
      assignment_note: d.assignment_note ?? null,
      special_status_id: d.special_status_id ?? null,
      amount_owed: d.required_amount != null ? Number(d.required_amount) : null,
      governorate: d.governorate ?? null,
      current_task_id: d.current_task_id ?? null,
      current_task_label: def?.label ?? null,
    }
  })
}
