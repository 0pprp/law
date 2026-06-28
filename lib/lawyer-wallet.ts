import type { SupabaseClient } from '@supabase/supabase-js'
import type { WalletTransactionType, LawyerWalletKind } from '@/lib/types'

export type { LawyerWalletKind }

export interface LawyerWalletRow {
  id: string
  type: WalletTransactionType
  wallet: LawyerWalletKind
  amount: number
  notes: string | null
  reference_id: string | null
  created_at: string
  created_by: string | null
  creator?: { full_name: string } | null
}

const TX_SELECT = 'id, type, wallet, amount, notes, reference_id, created_at, created_by, creator:profiles!lawyer_wallet_transactions_created_by_fkey(full_name)'
const TX_SELECT_LEGACY = 'id, type, amount, notes, reference_id, created_at, created_by, creator:profiles!lawyer_wallet_transactions_created_by_fkey(full_name)'

const SCHEMA_RELOAD_HINT = 'نفّذ NOTIFY pgrst, \'reload schema\'; من Supabase SQL Editor ثم أعد المحاولة.'

/** Cached: true = column usable, false = legacy (no column), null = unchecked */
let walletColumnReady: boolean | null = null

function isWalletSchemaCacheError(error: { message?: string } | null | undefined): boolean {
  return (error?.message ?? '').toLowerCase().includes('schema cache')
}

function isMissingWalletColumnError(error: { message?: string } | null | undefined): boolean {
  const msg = (error?.message ?? '').toLowerCase()
  if (isWalletSchemaCacheError(error)) return false
  return msg.includes('wallet') && msg.includes('column')
}

/** صرفيات — never mixed with fees (legacy mode without wallet column) */
const DISBURSEMENT_TYPES = new Set<string>([
  'accountant_transfer', 'transfer_from_savings', 'savings_withdrawal', 'task_expense_deduction',
])

function legacyWalletForType(type: string): LawyerWalletKind {
  if (DISBURSEMENT_TYPES.has(type)) return 'savings'
  return 'fees'
}

async function probeWalletColumn(supabase: SupabaseClient): Promise<boolean> {
  if (walletColumnReady != null) return walletColumnReady
  const { error } = await supabase.from('lawyer_wallet_transactions').select('wallet').limit(1)
  if (!error) {
    walletColumnReady = true
    return true
  }
  if (isWalletSchemaCacheError(error)) {
    walletColumnReady = true
    return true
  }
  if (isMissingWalletColumnError(error)) {
    walletColumnReady = false
    return false
  }
  walletColumnReady = true
  return true
}

function rowMatchesWallet(row: { type: string }, wallet: LawyerWalletKind): boolean {
  return legacyWalletForType(row.type) === wallet
}

function sumAmounts(rows: { amount?: number | null }[] | null | undefined): number {
  return (rows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0)
}

/**
 * Fees balance — ONLY approved tasks (+) and fee payouts (−).
 * صرفيات never affect this balance.
 */
export async function fetchLawyerWalletBalance(
  supabase: SupabaseClient,
  lawyerId: string,
  wallet: LawyerWalletKind = 'fees',
): Promise<number> {
  if (wallet === 'savings') {
    return fetchLawyerDisbursementBalance(supabase, lawyerId)
  }
  return fetchLawyerFeesOnlyBalance(supabase, lawyerId)
}

async function fetchLawyerFeesOnlyBalance(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<number> {
  const hasWallet = await probeWalletColumn(supabase)

  if (hasWallet) {
    const { data: feeRows, error: feeErr } = await supabase
      .from('lawyer_wallet_transactions')
      .select('amount')
      .eq('lawyer_id', lawyerId)
      .eq('wallet', 'fees')
      .limit(5000)

    const { data: legacyFeeRows, error: legacyErr } = await supabase
      .from('lawyer_wallet_transactions')
      .select('type, amount')
      .eq('lawyer_id', lawyerId)
      .is('wallet', null)
      .limit(5000)

    if (feeErr) {
      if (isWalletSchemaCacheError(feeErr) || isMissingWalletColumnError(feeErr)) {
        walletColumnReady = false
        return fetchLawyerFeesOnlyBalanceLegacy(supabase, lawyerId)
      }
    }

    const walletSum = sumAmounts(feeRows)
    const legacyFeeSum = sumAmounts(
      (legacyFeeRows ?? []).filter(r => rowMatchesWallet(r, 'fees')),
    )
    const total = walletSum + legacyFeeSum
    if (total !== 0) return total
    return fetchLawyerFeesOnlyBalanceLegacy(supabase, lawyerId)
  }

  return fetchLawyerFeesOnlyBalanceLegacy(supabase, lawyerId)
}

async function fetchLawyerFeesOnlyBalanceLegacy(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<number> {
  const { data: rows } = await supabase
    .from('lawyer_wallet_transactions')
    .select('type, amount')
    .eq('lawyer_id', lawyerId)
    .limit(5000)
  return sumAmounts((rows ?? []).filter(r => rowMatchesWallet(r, 'fees')))
}

/** Disbursements (صرفيات) balance — إيداع وسحب وخصم صرفيات المهام */
async function fetchLawyerDisbursementBalance(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<number> {
  const hasWallet = await probeWalletColumn(supabase)

  if (hasWallet) {
    const { data: rows, error } = await supabase
      .from('lawyer_wallet_transactions')
      .select('amount')
      .eq('lawyer_id', lawyerId)
      .eq('wallet', 'savings')
      .limit(5000)

    if (error && isWalletSchemaCacheError(error)) {
      return fetchLawyerDisbursementBalanceLegacy(supabase, lawyerId)
    }
    return sumAmounts(rows)
  }

  return fetchLawyerDisbursementBalanceLegacy(supabase, lawyerId)
}

async function fetchLawyerDisbursementBalanceLegacy(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<number> {
  const { data: rows } = await supabase
    .from('lawyer_wallet_transactions')
    .select('type, amount')
    .eq('lawyer_id', lawyerId)
    .limit(5000)
  return sumAmounts((rows ?? []).filter(r => rowMatchesWallet(r, 'savings')))
}

export async function fetchLawyerSavingsBalance(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<number> {
  return fetchLawyerDisbursementBalance(supabase, lawyerId)
}

export interface LawyerWalletBalances {
  fees: number
  savings: number
}

export async function fetchLawyerWalletBalances(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<LawyerWalletBalances> {
  const [fees, savings] = await Promise.all([
    fetchLawyerFeesOnlyBalance(supabase, lawyerId),
    fetchLawyerDisbursementBalance(supabase, lawyerId),
  ])
  return { fees, savings }
}

async function sumBalancesByLawyer(
  supabase: SupabaseClient,
  lawyerIds: string[],
  wallet: LawyerWalletKind,
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  await Promise.all(lawyerIds.map(async id => {
    const bal = await fetchLawyerWalletBalance(supabase, id, wallet)
    map.set(id, bal)
  }))
  return map
}

export async function fetchLawyerBalancesMap(
  supabase: SupabaseClient,
  lawyerIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!lawyerIds.length) return map
  await Promise.all(lawyerIds.map(async id => {
    map.set(id, await fetchLawyerFeesOnlyBalance(supabase, id))
  }))
  return map
}

export async function fetchLawyerSavingsBalancesMap(
  supabase: SupabaseClient,
  lawyerIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!lawyerIds.length) return map
  await Promise.all(lawyerIds.map(async id => {
    map.set(id, await fetchLawyerDisbursementBalance(supabase, id))
  }))
  return map
}

export async function fetchLawyerWalletTransactions(
  supabase: SupabaseClient,
  lawyerId: string,
  limit = 100,
  wallet?: LawyerWalletKind,
): Promise<LawyerWalletRow[]> {
  const hasWallet = await probeWalletColumn(supabase)

  let q = (supabase as any)
    .from('lawyer_wallet_transactions')
    .select(hasWallet ? TX_SELECT : TX_SELECT_LEGACY)
    .eq('lawyer_id', lawyerId)
    .order('created_at', { ascending: false })
    .limit(hasWallet && wallet ? limit : 500)

  if (hasWallet && wallet) q = q.eq('wallet', wallet)

  const { data, error } = await q
  if (error && isMissingWalletColumnError(error)) {
    walletColumnReady = false
    return fetchLawyerWalletTransactions(supabase, lawyerId, limit, wallet)
  }

  let rows = (data ?? []) as LawyerWalletRow[]

  if (hasWallet && wallet) {
    rows = rows.filter(r => (r.wallet ?? legacyWalletForType(r.type)) === wallet)
  } else if (!hasWallet && wallet) {
    rows = rows.filter(r => rowMatchesWallet(r, wallet))
  }

  return rows.slice(0, limit).map(row => ({
    ...row,
    wallet: (hasWallet && row.wallet ? row.wallet : legacyWalletForType(row.type)) as LawyerWalletKind,
  }))
}

function isTransactionTypeCheckError(error: { message?: string } | null | undefined): boolean {
  const msg = (error?.message ?? '').toLowerCase()
  return msg.includes('type_check') || msg.includes('wallet_transaction_type') || msg.includes('invalid input value for enum')
}

type InsertResult = { ok: true } | { ok: false; error: string; typeRejected?: boolean }

export async function insertWalletTransaction(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
): Promise<InsertResult> {
  const hasWallet = await probeWalletColumn(supabase)

  if (!hasWallet) {
    const { wallet: _w, ...legacy } = row
    const { error } = await supabase.from('lawyer_wallet_transactions').insert(legacy)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  const { error } = await supabase.from('lawyer_wallet_transactions').insert(row)
  if (error) {
    if (isWalletSchemaCacheError(error)) {
      return { ok: false, error: `${error.message} — ${SCHEMA_RELOAD_HINT}` }
    }
    return {
      ok: false,
      error: error.message,
      typeRejected: isTransactionTypeCheckError(error),
    }
  }
  return { ok: true }
}

async function insertWithTypeFallback(
  supabase: SupabaseClient,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const result = await insertWalletTransaction(supabase, primary)
  if (result.ok) return result
  if (result.typeRejected) {
    return insertWalletTransaction(supabase, fallback)
  }
  return result
}

export async function creditLawyerWallet(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    amount: number
    type: 'accountant_transfer' | 'manual_adjustment' | 'approved_task_payment'
    wallet?: LawyerWalletKind
    notes?: string | null
    createdBy: string
    referenceId?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  if (params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }

  const wallet = params.wallet ?? (params.type === 'accountant_transfer' ? 'savings' : 'fees')

  if (params.type === 'accountant_transfer' && wallet !== 'savings') {
    return { ok: false, error: 'الصرفيات تُسجّل في محفظة الصرفيات فقط' }
  }

  const row = {
    lawyer_id: params.lawyerId,
    type: params.type,
    wallet,
    amount: params.amount,
    notes: params.notes ?? null,
    reference_id: params.referenceId ?? null,
    created_by: params.createdBy,
  }

  if (params.type === 'approved_task_payment') {
    return insertWithTypeFallback(
      supabase,
      row,
      { ...row, type: 'manual_adjustment' },
    )
  }

  return insertWalletTransaction(supabase, row)
}

/** Admin credit — محفظة الصرفيات only */
export async function creditLawyerSavingsWallet(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    amount: number
    notes?: string | null
    createdBy: string
  },
): Promise<{ ok: boolean; error?: string }> {
  return creditLawyerWallet(supabase, {
    ...params,
    type: 'accountant_transfer',
    wallet: 'savings',
  })
}

/** Admin withdrawal — محفظة الصرفيات only */
export async function withdrawLawyerSavings(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    amount: number
    notes?: string | null
    createdBy: string
  },
): Promise<{ ok: boolean; error?: string; newBalance?: number }> {
  if (params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }

  const balance = await fetchLawyerDisbursementBalance(supabase, params.lawyerId)
  if (params.amount > balance) {
    return {
      ok: false,
      error: `رصيد الصرفيات غير كافٍ — المتاح: ${balance.toLocaleString('en-US')} د.ع`,
    }
  }

  const note = params.notes?.trim() || 'سحب صرفيات'
  const row = {
    lawyer_id: params.lawyerId,
    wallet: 'savings' as const,
    amount: -params.amount,
    notes: note,
    created_by: params.createdBy,
  }

  const result = await insertWalletTransaction(supabase, {
    ...row,
    type: 'accountant_transfer',
  })
  if (!result.ok) return result
  return { ok: true, newBalance: balance - params.amount }
}

/** Fee payout — محفظة الأتعاب only, cannot exceed task-earned balance */
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

  const balance = await fetchLawyerFeesOnlyBalance(supabase, params.lawyerId)
  if (balance <= 0) {
    return { ok: false, error: 'لا يوجد رصيد أتعاب — تُضاف الأتعاب عند اختيار المهمة التالية أو إغلاق القضية' }
  }
  if (params.amount > balance) {
    return { ok: false, error: `رصيد الأتعاب غير كافٍ — المتاح: ${balance.toLocaleString('en-US')} د.ع` }
  }

  const note = params.notes?.trim() || 'صرف أتعاب للمحامي'
  const base = {
    lawyer_id: params.lawyerId,
    wallet: 'fees' as const,
    amount: -params.amount,
    notes: note,
    created_by: params.createdBy,
  }

  const result = await insertWithTypeFallback(
    supabase,
    { ...base, type: 'fee_payout' },
    { ...base, type: 'manual_adjustment' },
  )
  if (!result.ok) return result
  return { ok: true, newBalance: balance - params.amount }
}
