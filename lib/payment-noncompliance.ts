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
  options?: { offset?: number; limit?: number },
): Promise<{ rows: PendingNoncomplianceRow[]; total: number; error: string | null }> {
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(100, Math.max(1, options?.limit ?? 50))

  let q = supabase
    .from('payment_noncompliance_requests')
    .select('id, debtor_id, branch_id, source_task_id, requested_by, note, status, reviewed_by, reviewed_at, rejection_reason, created_task_id, created_at, updated_at', { count: 'exact' })
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (branchId) q = q.eq('branch_id', branchId)

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
