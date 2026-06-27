import type { SupabaseClient } from '@supabase/supabase-js'
import type { WalletTransactionType } from '@/lib/types'

export interface LawyerWalletRow {
  id: string
  type: WalletTransactionType
  amount: number
  notes: string | null
  reference_id: string | null
  created_at: string
  created_by: string | null
  creator?: { full_name: string } | null
}

/** Sum of all wallet transactions for one lawyer. */
export async function fetchLawyerWalletBalance(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<number> {
  const { data } = await (supabase as any)
    .from('lawyer_wallet_transactions')
    .select('amount.sum()')
    .eq('lawyer_id', lawyerId)
    .single()
  const raw = (data as { sum?: string | number | null })?.sum
  if (raw != null) return Number(raw)

  const { data: rows } = await supabase
    .from('lawyer_wallet_transactions')
    .select('amount')
    .eq('lawyer_id', lawyerId)
    .limit(1000)
  return (rows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0)
}

/** Balances for many lawyers in one query. */
export async function fetchLawyerBalancesMap(
  supabase: SupabaseClient,
  lawyerIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!lawyerIds.length) return map

  const { data } = await supabase
    .from('lawyer_wallet_transactions')
    .select('lawyer_id, amount')
    .in('lawyer_id', lawyerIds)
    .limit(5000)

  for (const row of data ?? []) {
    const id = row.lawyer_id as string
    map.set(id, (map.get(id) ?? 0) + Number(row.amount ?? 0))
  }
  for (const id of lawyerIds) {
    if (!map.has(id)) map.set(id, 0)
  }
  return map
}

export async function fetchLawyerWalletTransactions(
  supabase: SupabaseClient,
  lawyerId: string,
  limit = 100,
): Promise<LawyerWalletRow[]> {
  const { data } = await (supabase as any)
    .from('lawyer_wallet_transactions')
    .select('id, type, amount, notes, reference_id, created_at, created_by, creator:profiles!lawyer_wallet_transactions_created_by_fkey(full_name)')
    .eq('lawyer_id', lawyerId)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as LawyerWalletRow[]
}

export async function creditLawyerWallet(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    amount: number
    type: 'accountant_transfer' | 'manual_adjustment'
    notes?: string | null
    createdBy: string
    referenceId?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  if (params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }

  const { error } = await supabase.from('lawyer_wallet_transactions').insert({
    lawyer_id: params.lawyerId,
    type: params.type,
    amount: params.amount,
    notes: params.notes ?? null,
    reference_id: params.referenceId ?? null,
    created_by: params.createdBy,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Record a fee payout — decreases lawyer balance (negative amount). */
export async function payoutLawyerFees(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    amount: number
    notes?: string | null
    createdBy: string
  },
): Promise<{ ok: boolean; error?: string; newBalance?: number }> {
  if (params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }

  const balance = await fetchLawyerWalletBalance(supabase, params.lawyerId)
  if (params.amount > balance) {
    return { ok: false, error: `الرصيد غير كافٍ — المتاح: ${balance.toLocaleString('en-US')} د.ع` }
  }

  const { error } = await supabase.from('lawyer_wallet_transactions').insert({
    lawyer_id: params.lawyerId,
    type: 'fee_payout',
    amount: -params.amount,
    notes: params.notes?.trim() || 'صرف أتعاب للمحامي',
    created_by: params.createdBy,
  })
  if (error) {
    // Fallback if DB enum not migrated yet
    const fallback = await supabase.from('lawyer_wallet_transactions').insert({
      lawyer_id: params.lawyerId,
      type: 'manual_adjustment',
      amount: -params.amount,
      notes: params.notes?.trim() || 'صرف أتعاب للمحامي',
      created_by: params.createdBy,
    })
    if (fallback.error) return { ok: false, error: fallback.error.message }
  }
  return { ok: true, newBalance: balance - params.amount }
}
