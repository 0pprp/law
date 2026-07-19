import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * «الأسماء التي تحت إسناد مهمة» — مدينون قضيتهم مفتوحة وليست لهم مهمة مطلوبة
 * (current_task_id IS NULL). يختلفون عن المهام غير المكلفة (مهمة موجودة بلا محامٍ).
 */
export interface AwaitingAssignmentDebtor {
  id: string
  full_name: string
  branch_id: string | null
  branch_name: string | null
  created_at: string
  assignment_note: string | null
  case_type: 'civil' | 'criminal'
}

export interface FetchAwaitingAssignmentOptions {
  search?: string
  offset?: number
  limit?: number
}

export interface FetchAwaitingAssignmentResult {
  rows: AwaitingAssignmentDebtor[]
  total: number
  /** عمود assignment_note غير مطبق بعد في قاعدة البيانات */
  noteColumnMissing: boolean
  error: string | null
}

const BASE_COLS = 'id, full_name, branch_id, created_at, case_type'

function isMissingNoteColumnError(message: string | undefined | null): boolean {
  return !!message && message.includes('assignment_note')
}

/** الأقدم أولاً حتى تظهر الحالات المتأخرة في الإسناد قبل غيرها */
export async function fetchAwaitingAssignmentDebtors(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchAwaitingAssignmentOptions,
): Promise<FetchAwaitingAssignmentResult> {
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(100, Math.max(1, options?.limit ?? 50))
  const search = (options?.search ?? '').trim().replace(/[%_,]/g, '')

  const buildQuery = (cols: string) => {
    let q = supabase
      .from('debtors')
      .select(cols, { count: 'exact' })
      .is('current_task_id', null)
      .or('case_status.is.null,and(case_status.neq.closed,case_status.neq.payment_in_progress)')
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1)
    if (branchId) q = q.eq('branch_id', branchId)
    if (search) q = q.ilike('full_name', `%${search}%`)
    return q
  }

  let noteColumnMissing = false
  let res = await buildQuery(`${BASE_COLS}, assignment_note`)
  if (res.error && isMissingNoteColumnError(res.error.message)) {
    noteColumnMissing = true
    res = await buildQuery(BASE_COLS)
  }
  if (res.error) {
    return { rows: [], total: 0, noteColumnMissing, error: res.error.message }
  }

  const raw = (res.data ?? []) as unknown as Array<{
    id: string
    full_name: string | null
    branch_id: string | null
    created_at: string
    case_type?: string | null
    assignment_note?: string | null
  }>

  const branchIds = [...new Set(raw.map(r => r.branch_id).filter(Boolean))] as string[]
  const branchNames = new Map<string, string>()
  if (branchIds.length) {
    const { data: branches } = await supabase.from('branches').select('id, name').in('id', branchIds)
    for (const b of branches ?? []) branchNames.set(b.id, b.name)
  }

  const rows: AwaitingAssignmentDebtor[] = raw.map(r => ({
    id: r.id,
    full_name: r.full_name ?? '—',
    branch_id: r.branch_id,
    branch_name: r.branch_id ? branchNames.get(r.branch_id) ?? null : null,
    created_at: r.created_at,
    assignment_note: r.assignment_note ?? null,
    case_type: r.case_type === 'criminal' ? 'criminal' : 'civil',
  }))

  return { rows, total: res.count ?? 0, noteColumnMissing, error: null }
}
