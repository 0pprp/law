import type { SupabaseClient } from '@supabase/supabase-js'
import type { WalletTransactionType, LawyerWalletKind } from '@/lib/types'
import { formatMoney } from '@/lib/money-input'
import {
  canSeeCriminalTaskFees,
  shouldCountFeesWalletTxForViewer,
} from '@/lib/visible-task-fee'

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
  if (
    type === 'legal_manager_task_bonus'
    || type === 'legal_manager_percentage_fee'
    || type === 'legal_manager_withdrawal'
    || type === 'legal_manager_manual_deposit'
    || type === 'legal_manager_manual_withdrawal'
  ) return 'legal_manager'
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
 * الجزائي: غير المدير لا يحتسب إيداعات أتعاب المهام الجزائية في الرصيد الظاهر.
 */
export async function fetchLawyerWalletBalance(
  supabase: SupabaseClient,
  lawyerId: string,
  wallet: LawyerWalletKind = 'fees',
  opts?: { viewerRole?: string | null },
): Promise<number> {
  if (wallet === 'savings') {
    return fetchLawyerDisbursementBalance(supabase, lawyerId)
  }
  if (wallet === 'legal_manager') {
    return fetchLegalManagerDrawerBalance(supabase, lawyerId)
  }
  return fetchLawyerFeesOnlyBalance(supabase, lawyerId, opts)
}

async function fetchLegalManagerDrawerBalance(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<number> {
  const hasWallet = await probeWalletColumn(supabase)
  if (!hasWallet) return 0

  const { data, error } = await supabase
    .from('lawyer_wallet_transactions')
    .select('amount')
    .eq('lawyer_id', ownerId)
    .eq('wallet', 'legal_manager')
    .limit(5000)

  if (error) return 0
  return sumAmounts(data)
}

async function loadCriminalTaskIdsForRefs(
  supabase: SupabaseClient,
  referenceIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(referenceIds.map(String).filter(Boolean))]
  if (!ids.length) return new Set()
  const criminal = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, debtor:debtors!tasks_debtor_id_fkey(case_type)')
      .in('id', chunk)
    for (const t of tasks ?? []) {
      const debtor = Array.isArray(t.debtor) ? t.debtor[0] : t.debtor
      const ct = (debtor as { case_type?: string } | null)?.case_type
      if (ct === 'criminal') criminal.add(String(t.id))
    }
  }
  return criminal
}

async function sumFeesRowsForViewer(
  supabase: SupabaseClient,
  rows: { amount?: number | null; type?: string | null; reference_id?: string | null }[],
  viewerRole?: string | null,
): Promise<number> {
  if (!rows.length) return 0
  if (canSeeCriminalTaskFees(viewerRole)) return sumAmounts(rows)
  const refs = rows
    .filter(r => r.type === 'approved_task_payment' && r.reference_id)
    .map(r => String(r.reference_id))
  const criminalTaskIds = await loadCriminalTaskIdsForRefs(supabase, refs)
  return rows.reduce((s, r) => {
    if (!shouldCountFeesWalletTxForViewer(viewerRole, r, criminalTaskIds)) return s
    return s + (Number(r.amount ?? 0) || 0)
  }, 0)
}

async function fetchLawyerFeesOnlyBalance(
  supabase: SupabaseClient,
  lawyerId: string,
  opts?: { viewerRole?: string | null },
): Promise<number> {
  const viewerRole = opts?.viewerRole
  const hasWallet = await probeWalletColumn(supabase)

  if (hasWallet) {
    const { data: feeRows, error: feeErr } = await supabase
      .from('lawyer_wallet_transactions')
      .select('amount, type, reference_id')
      .eq('lawyer_id', lawyerId)
      .eq('wallet', 'fees')
      .limit(5000)

    const { data: legacyFeeRows } = await supabase
      .from('lawyer_wallet_transactions')
      .select('type, amount, reference_id')
      .eq('lawyer_id', lawyerId)
      .is('wallet', null)
      .limit(5000)

    if (feeErr) {
      if (isWalletSchemaCacheError(feeErr) || isMissingWalletColumnError(feeErr)) {
        walletColumnReady = false
        return fetchLawyerFeesOnlyBalanceLegacy(supabase, lawyerId, opts)
      }
    }

    const walletSum = await sumFeesRowsForViewer(supabase, feeRows ?? [], viewerRole)
    const legacyFeeSum = await sumFeesRowsForViewer(
      supabase,
      (legacyFeeRows ?? []).filter(r => rowMatchesWallet(r, 'fees')),
      viewerRole,
    )
    const total = walletSum + legacyFeeSum
    if (total !== 0) return total
    return fetchLawyerFeesOnlyBalanceLegacy(supabase, lawyerId, opts)
  }

  return fetchLawyerFeesOnlyBalanceLegacy(supabase, lawyerId, opts)
}

async function fetchLawyerFeesOnlyBalanceLegacy(
  supabase: SupabaseClient,
  lawyerId: string,
  opts?: { viewerRole?: string | null },
): Promise<number> {
  const { data: rows } = await supabase
    .from('lawyer_wallet_transactions')
    .select('type, amount, reference_id')
    .eq('lawyer_id', lawyerId)
    .limit(5000)
  const feeRows = (rows ?? []).filter(r => rowMatchesWallet(r, 'fees'))
  return sumFeesRowsForViewer(supabase, feeRows, opts?.viewerRole)
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
  opts?: { viewerRole?: string | null },
): Promise<LawyerWalletBalances> {
  const [fees, savings] = await Promise.all([
    fetchLawyerFeesOnlyBalance(supabase, lawyerId, opts),
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
  opts?: { viewerRole?: string | null },
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!lawyerIds.length) return map
  await Promise.all(lawyerIds.map(async id => {
    map.set(id, await fetchLawyerFeesOnlyBalance(supabase, id, opts))
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
  opts?: { viewerRole?: string | null },
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
    return fetchLawyerWalletTransactions(supabase, lawyerId, limit, wallet, opts)
  }

  let rows = (data ?? []) as LawyerWalletRow[]

  if (hasWallet && wallet) {
    rows = rows.filter(r => (r.wallet ?? legacyWalletForType(r.type)) === wallet)
  } else if (!hasWallet && wallet) {
    rows = rows.filter(r => rowMatchesWallet(r, wallet))
  }

  // محفظة الصرفيات: لا تُعدَّل. الأتعاب: إخفاء مبالغ المهام الجزائية لغير المدير.
  if (wallet === 'fees' || wallet === undefined) {
    const viewerRole = opts?.viewerRole
    if (!canSeeCriminalTaskFees(viewerRole)) {
      const feeLike = rows.filter(r =>
        wallet === 'fees' ? true : rowMatchesWallet(r, 'fees'),
      )
      const refs = feeLike
        .filter(r => r.type === 'approved_task_payment' && r.reference_id)
        .map(r => String(r.reference_id))
      const criminalTaskIds = await loadCriminalTaskIdsForRefs(supabase, refs)
      rows = rows.map(r => {
        const isFeesRow = wallet === 'fees' || rowMatchesWallet(r, 'fees')
        if (!isFeesRow) return r
        if (!shouldCountFeesWalletTxForViewer(viewerRole, r, criminalTaskIds)) {
          return { ...r, amount: 0 }
        }
        return r
      })
    }
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
): Promise<{ ok: boolean; error?: string; alreadyCredited?: boolean }> {
  if (params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }

  if (params.referenceId) {
    const { data: existing } = await supabase
      .from('lawyer_wallet_transactions')
      .select('id')
      .eq('reference_id', params.referenceId)
      .limit(1)
      .maybeSingle()
    if (existing) return { ok: true, alreadyCredited: true }
  }

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
    referenceId?: string | null
  },
): Promise<{ ok: boolean; error?: string; alreadyCredited?: boolean }> {
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
    referenceId?: string | null
  },
): Promise<{ ok: boolean; error?: string; newBalance?: number; alreadyWithdrawn?: boolean }> {
  if (params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }

  if (params.referenceId) {
    const { data: existing } = await supabase
      .from('lawyer_wallet_transactions')
      .select('id')
      .eq('reference_id', params.referenceId)
      .limit(1)
      .maybeSingle()
    if (existing) return { ok: true, alreadyWithdrawn: true }
  }

  const balance = await fetchLawyerDisbursementBalance(supabase, params.lawyerId)
  if (params.amount > balance) {
    return {
      ok: false,
      error: `رصيد الصرفيات غير كافٍ — المتاح: ${formatMoney(balance)}`,
    }
  }

  const note = params.notes?.trim() || 'سحب صرفيات'
  const row = {
    lawyer_id: params.lawyerId,
    wallet: 'savings' as const,
    amount: -params.amount,
    notes: note,
    created_by: params.createdBy,
    reference_id: params.referenceId ?? null,
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
    referenceId?: string | null
  },
): Promise<{ ok: boolean; error?: string; newBalance?: number; alreadyWithdrawn?: boolean }> {
  if (params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }

  if (params.referenceId) {
    const { data: existing } = await supabase
      .from('lawyer_wallet_transactions')
      .select('id')
      .eq('reference_id', params.referenceId)
      .limit(1)
      .maybeSingle()
    if (existing) return { ok: true, alreadyWithdrawn: true }
  }

  const balance = await fetchLawyerFeesOnlyBalance(supabase, params.lawyerId)
  if (balance <= 0) {
    return { ok: false, error: 'لا يوجد رصيد أتعاب — تُضاف الأتعاب عند اختيار المهمة التالية أو إغلاق القضية' }
  }
  if (params.amount > balance) {
    return { ok: false, error: `رصيد الأتعاب غير كافٍ — المتاح: ${formatMoney(balance)}` }
  }

  const note = params.notes?.trim() || 'صرف أتعاب للمحامي'
  const base = {
    lawyer_id: params.lawyerId,
    wallet: 'fees' as const,
    amount: -params.amount,
    notes: note,
    created_by: params.createdBy,
    reference_id: params.referenceId ?? null,
  }

  const result = await insertWithTypeFallback(
    supabase,
    { ...base, type: 'fee_payout' },
    { ...base, type: 'manual_adjustment' },
  )
  if (!result.ok) return result
  return { ok: true, newBalance: balance - params.amount }
}

/** سحب معتمد من محفظة مدير القانونية */
export async function payoutLegalManagerWallet(
  supabase: SupabaseClient,
  params: {
    legalManagerUserId: string
    amount: number
    notes?: string | null
    createdBy: string
  },
): Promise<{ ok: boolean; error?: string; newBalance?: number }> {
  if (params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }

  const balance = await fetchLawyerWalletBalance(supabase, params.legalManagerUserId, 'legal_manager')
  if (balance <= 0) {
    return { ok: false, error: 'لا يوجد رصيد في محفظة مدير القانونية' }
  }
  if (params.amount > balance) {
    return {
      ok: false,
      error: `رصيد المحفظة غير كافٍ — المتاح: ${formatMoney(balance)}`,
    }
  }

  const note = params.notes?.trim() || 'سحب معتمد — محفظة مدير القانونية'
  const result = await insertWalletTransaction(supabase, {
    lawyer_id: params.legalManagerUserId,
    type: 'legal_manager_withdrawal',
    wallet: 'legal_manager',
    amount: -params.amount,
    notes: note,
    created_by: params.createdBy,
  })
  if (!result.ok) return result
  return { ok: true, newBalance: balance - params.amount }
}
