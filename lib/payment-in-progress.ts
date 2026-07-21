import type { SupabaseClient } from '@supabase/supabase-js'
import { CASE_STATUS_PAYMENT_IN_PROGRESS } from '@/lib/types'

export interface PaymentInProgressDebtor {
  id: string
  full_name: string
  branch_id: string | null
  branch_name: string | null
  remaining_amount: number
  total_payments: number
  last_payment_date: string | null
  created_at: string
}

export interface FetchPaymentInProgressOptions {
  search?: string
  offset?: number
  limit?: number
  branchListId?: string | null
  caseType?: 'civil' | 'criminal' | null
}

export async function fetchPaymentInProgressDebtors(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchPaymentInProgressOptions,
): Promise<{ rows: PaymentInProgressDebtor[]; total: number; error: string | null }> {
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(100, Math.max(1, options?.limit ?? 50))
  const search = (options?.search ?? '').trim().replace(/[%_,]/g, '')
  const branchListId = options?.branchListId?.trim() || null
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null

  let q = supabase
    .from('debtors')
    .select('id, full_name, branch_id, remaining_amount, total_payments, created_at', { count: 'exact' })
    .eq('case_status', CASE_STATUS_PAYMENT_IN_PROGRESS)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (branchId) q = q.eq('branch_id', branchId)
  if (branchListId) q = q.eq('branch_list_id', branchListId)
  if (caseType) q = q.eq('case_type', caseType)
  if (search) q = q.ilike('full_name', `%${search}%`)

  const { data, count, error } = await q
  if (error) return { rows: [], total: 0, error: error.message }

  const raw = data ?? []
  const ids = raw.map(r => r.id)
  const lastPay = new Map<string, string>()

  if (ids.length) {
    const { data: pays } = await supabase
      .from('debtor_payments')
      .select('debtor_id, payment_date')
      .in('debtor_id', ids)
      .order('payment_date', { ascending: false })

    for (const p of pays ?? []) {
      if (p.debtor_id && p.payment_date && !lastPay.has(p.debtor_id)) {
        lastPay.set(p.debtor_id, p.payment_date)
      }
    }
  }

  const branchIds = [...new Set(raw.map(r => r.branch_id).filter(Boolean))] as string[]
  const branchNames = new Map<string, string>()
  if (branchIds.length) {
    const { data: branches } = await supabase.from('branches').select('id, name').in('id', branchIds)
    for (const b of branches ?? []) branchNames.set(b.id, b.name)
  }

  const rows: PaymentInProgressDebtor[] = raw.map(r => ({
    id: r.id,
    full_name: r.full_name ?? '—',
    branch_id: r.branch_id,
    branch_name: r.branch_id ? branchNames.get(r.branch_id) ?? null : null,
    remaining_amount: Number(r.remaining_amount) || 0,
    total_payments: Number(r.total_payments) || 0,
    last_payment_date: lastPay.get(r.id) ?? null,
    created_at: r.created_at,
  }))

  return { rows, total: count ?? 0, error: null }
}

export interface PaymentBranchSummary {
  branchId: string
  branchName: string
  count: number
}

/** فروع فيها مدينون بجاري التسديد فقط */
export async function fetchPaymentInProgressBranchSummaries(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: Pick<FetchPaymentInProgressOptions, 'search' | 'caseType'>,
): Promise<{ branches: PaymentBranchSummary[]; error: string | null }> {
  const search = (options?.search ?? '').trim().replace(/[%_,]/g, '')
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null
  const counts = new Map<string, number>()
  let offset = 0
  const CHUNK = 1000

  while (true) {
    let q = supabase
      .from('debtors')
      .select('branch_id')
      .eq('case_status', CASE_STATUS_PAYMENT_IN_PROGRESS)
      .order('id')
      .range(offset, offset + CHUNK - 1)
    if (branchId) q = q.eq('branch_id', branchId)
    if (caseType) q = q.eq('case_type', caseType)
    if (search) q = q.ilike('full_name', `%${search}%`)
    const { data, error } = await q
    if (error) return { branches: [], error: error.message }
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
  const result: PaymentBranchSummary[] = ids.map(id => ({
    branchId: id,
    branchName: nameMap.get(id) ?? 'فرع',
    count: counts.get(id) ?? 0,
  }))
  result.sort((a, b) => a.branchName.localeCompare(b.branchName, 'ar'))
  return { branches: result, error: null }
}

export async function countPaymentInProgress(
  supabase: SupabaseClient,
  branchId: string | null,
  branchListId?: string | null,
  caseType?: 'civil' | 'criminal' | null,
): Promise<number> {
  let q = supabase
    .from('debtors')
    .select('id', { count: 'exact', head: true })
    .eq('case_status', CASE_STATUS_PAYMENT_IN_PROGRESS)
  if (branchId) q = q.eq('branch_id', branchId)
  if (branchListId) q = q.eq('branch_list_id', branchListId)
  if (caseType === 'civil' || caseType === 'criminal') q = q.eq('case_type', caseType)
  const { count, error } = await q
  if (error) return 0
  return count ?? 0
}
