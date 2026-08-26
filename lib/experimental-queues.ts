/**
 * طوابير فرع «تجريبي» فقط: الأسماء المضافة مؤخراً + أرشيف القانونية.
 * الأرشفة عبر صفة خاصة على الفرع التجريبي (بدون عمود DB جديد).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { EXPERIMENTAL_BRANCH_NAME } from '@/lib/branch-constants'

export const LEGAL_ARCHIVE_STATUS_NAME = 'أرشيف القانونية'

export type ExperimentalQueue = 'recent' | 'archive'

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

export async function resolveExperimentalBranchId(
  supabase: SupabaseClient,
): Promise<string | null> {
  const { data } = await supabase
    .from('branches')
    .select('id')
    .eq('name', EXPERIMENTAL_BRANCH_NAME)
    .eq('is_active', true)
    .maybeSingle()
  return data?.id ?? null
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

export async function countExperimentalQueue(
  supabase: SupabaseClient,
  queue: ExperimentalQueue,
  branchId: string,
  archiveStatusId: string,
): Promise<number> {
  let q = supabase
    .from('debtors')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', branchId)
    .not('case_status', 'eq', 'closed')

  if (queue === 'archive') {
    q = q.eq('special_status_id', archiveStatusId)
  } else {
    q = q.is('special_status_id', null)
  }

  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function listExperimentalQueue(
  supabase: SupabaseClient,
  queue: ExperimentalQueue,
  branchId: string,
  archiveStatusId: string,
  opts?: { q?: string; limit?: number; offset?: number },
): Promise<ExperimentalDebtorRow[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200)
  const offset = Math.max(opts?.offset ?? 0, 0)

  let q = supabase
    .from('debtors')
    .select(
      'id, full_name, phone, receipt_number, branch_id, branch_list_id, created_at, assignment_note, special_status_id, required_amount, governorate, current_task_id, current_task:tasks!current_task_id(id, task_definitions(label))',
    )
    .eq('branch_id', branchId)
    .not('case_status', 'eq', 'closed')

  if (queue === 'archive') {
    q = q.eq('special_status_id', archiveStatusId).order('created_at', { ascending: false })
  } else {
    q = q.is('special_status_id', null).order('created_at', { ascending: false })
  }

  const search = opts?.q?.trim()
  if (search) {
    q = q.or(
      `full_name.ilike.%${search}%,phone.ilike.%${search}%,receipt_number.ilike.%${search}%`,
    )
  }

  const { data, error } = await q.range(offset, offset + limit - 1)
  if (error) throw new Error(error.message)

  return (data ?? []).map((d: any) => ({
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
    current_task_label: d.current_task?.task_definitions?.label ?? null,
  }))
}
