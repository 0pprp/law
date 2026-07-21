import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaymentNoncomplianceRequest, PaymentNoncomplianceStatus } from '@/lib/types'

export interface PendingNoncomplianceRow extends PaymentNoncomplianceRequest {
  debtor_name: string
  branch_name: string | null
  requester_name: string | null
}

export async function fetchPendingNoncomplianceRequests(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: { offset?: number; limit?: number; branchListId?: string | null; caseType?: 'civil' | 'criminal' | null },
): Promise<{ rows: PendingNoncomplianceRow[]; total: number; error: string | null }> {
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(100, Math.max(1, options?.limit ?? 50))
  const branchListId = options?.branchListId?.trim() || null
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null

  let scopedDebtorIds: string[] | null = null
  if (branchListId || caseType) {
    let dq = supabase.from('debtors').select('id')
    if (branchId) dq = dq.eq('branch_id', branchId)
    if (branchListId) dq = dq.eq('branch_list_id', branchListId)
    if (caseType) dq = dq.eq('case_type', caseType)
    const { data: listDebtors, error: listErr } = await dq
    if (listErr) return { rows: [], total: 0, error: listErr.message }
    scopedDebtorIds = (listDebtors ?? []).map(d => d.id)
    if (!scopedDebtorIds.length) return { rows: [], total: 0, error: null }
  }

  let q = supabase
    .from('payment_noncompliance_requests')
    .select('id, debtor_id, branch_id, source_task_id, requested_by, note, status, reviewed_by, reviewed_at, rejection_reason, created_task_id, created_at, updated_at', { count: 'exact' })
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (branchId) q = q.eq('branch_id', branchId)
  if (scopedDebtorIds) q = q.in('debtor_id', scopedDebtorIds)

  const { data, count, error } = await q
  if (error) {
    if (error.message?.includes('payment_noncompliance_requests') || error.code === '42P01') {
      return {
        rows: [],
        total: 0,
        error: 'جدول طلبات عدم الالتزام غير مفعّل — شغّل supabase/scripts/apply-payment-noncompliance-requests.sql',
      }
    }
    return { rows: [], total: 0, error: error.message }
  }

  const raw = (data ?? []) as PaymentNoncomplianceRequest[]
  if (!raw.length) return { rows: [], total: count ?? 0, error: null }

  const debtorIds = [...new Set(raw.map(r => r.debtor_id))]
  const branchIds = [...new Set(raw.map(r => r.branch_id).filter(Boolean))] as string[]
  const requesterIds = [...new Set(raw.map(r => r.requested_by))]

  const [debtorsRes, branchesRes, profilesRes] = await Promise.all([
    supabase.from('debtors').select('id, full_name').in('id', debtorIds),
    branchIds.length
      ? supabase.from('branches').select('id, name').in('id', branchIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase.from('profiles').select('id, full_name').in('id', requesterIds),
  ])

  const debtorNames = new Map((debtorsRes.data ?? []).map(d => [d.id, d.full_name ?? '—']))
  const branchNames = new Map((branchesRes.data ?? []).map(b => [b.id, b.name]))
  const requesterNames = new Map((profilesRes.data ?? []).map(p => [p.id, p.full_name ?? null]))

  const rows: PendingNoncomplianceRow[] = raw.map(r => ({
    ...r,
    status: r.status as PaymentNoncomplianceStatus,
    debtor_name: debtorNames.get(r.debtor_id) ?? '—',
    branch_name: r.branch_id ? branchNames.get(r.branch_id) ?? null : null,
    requester_name: requesterNames.get(r.requested_by) ?? null,
  }))

  return { rows, total: count ?? 0, error: null }
}

export interface NoncomplianceBranchSummary {
  branchId: string
  branchName: string
  count: number
}

/** فروع فيها طلبات عدم التزام معلّقة فقط */
export async function fetchPendingNoncomplianceBranchSummaries(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: { caseType?: 'civil' | 'criminal' | null },
): Promise<{ branches: NoncomplianceBranchSummary[]; error: string | null }> {
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null
  let scopedDebtorIds: string[] | null = null
  if (caseType) {
    let dq = supabase.from('debtors').select('id')
    if (branchId) dq = dq.eq('branch_id', branchId)
    dq = dq.eq('case_type', caseType)
    const { data, error } = await dq
    if (error) return { branches: [], error: error.message }
    scopedDebtorIds = (data ?? []).map(d => d.id)
    if (!scopedDebtorIds.length) return { branches: [], error: null }
  }

  const counts = new Map<string, number>()
  let offset = 0
  const CHUNK = 500
  while (true) {
    let q = supabase
      .from('payment_noncompliance_requests')
      .select('branch_id')
      .eq('status', 'pending')
      .order('id')
      .range(offset, offset + CHUNK - 1)
    if (branchId) q = q.eq('branch_id', branchId)
    if (scopedDebtorIds) q = q.in('debtor_id', scopedDebtorIds)
    const { data, error } = await q
    if (error) {
      if (error.message?.includes('payment_noncompliance_requests') || error.code === '42P01') {
        return { branches: [], error: null }
      }
      return { branches: [], error: error.message }
    }
    const rows = data ?? []
    for (const r of rows) {
      const id = r.branch_id as string | null
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    if (rows.length < CHUNK) break
    offset += CHUNK
  }

  const ids = [...counts.entries()].filter(([, n]) => n > 0).map(([id]) => id)
  if (!ids.length) return { branches: [], error: null }

  const { data: branches } = await supabase.from('branches').select('id, name').in('id', ids)
  const nameMap = new Map((branches ?? []).map(b => [b.id as string, b.name as string]))
  const result: NoncomplianceBranchSummary[] = ids.map(id => ({
    branchId: id,
    branchName: nameMap.get(id) ?? 'فرع',
    count: counts.get(id) ?? 0,
  }))
  result.sort((a, b) => a.branchName.localeCompare(b.branchName, 'ar'))
  return { branches: result, error: null }
}

/** حالة الطلب المعلق لكل مدين (لصفحة متابعة التسديد) */
export async function fetchPendingNoncomplianceByDebtorIds(
  supabase: SupabaseClient,
  debtorIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!debtorIds.length) return map
  const { data, error } = await supabase
    .from('payment_noncompliance_requests')
    .select('id, debtor_id')
    .eq('status', 'pending')
    .in('debtor_id', debtorIds)
  if (error || !data) return map
  for (const r of data) {
    if (r.debtor_id) map.set(r.debtor_id, r.id)
  }
  return map
}
