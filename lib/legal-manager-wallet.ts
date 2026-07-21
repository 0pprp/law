import type { SupabaseClient } from '@supabase/supabase-js'
import type { LawyerWalletKind } from '@/lib/types'
import { taskLawyerId } from '@/lib/task-assignment'
import { logActivity } from '@/lib/activity-log'
import { insertWalletTransaction } from '@/lib/lawyer-wallet'
import { fetchLawyerPayoutRequests } from '@/lib/lawyer-payout-requests'
import { formatMoney } from '@/lib/money-input'

/** نسبة مسؤول القانونية من أتعاب المهمة عند اعتماد الإنجاز */
export const LEGAL_MANAGER_FEE_RATE = 0.05

export const LEGAL_MANAGER_WALLET: LawyerWalletKind = 'legal_manager'

export const LEGAL_MANAGER_PERCENTAGE_FEE_TYPE = 'legal_manager_percentage_fee' as const

/** @deprecated — للعرض في السجلات القديمة فقط */
export const LEGAL_MANAGER_BONUS_TYPE = 'legal_manager_task_bonus' as const

export const LEGAL_MANAGER_PERCENTAGE_FEE_NOTES =
  'نسبة 5% لمسؤول القانونية عند اعتماد إنجاز مهمة'

export const LEGAL_MANAGER_MANUAL_DEPOSIT_LABEL =
  'إيداع يدوي من الإدارة إلى محفظة مسؤول القانونية'

export const LEGAL_MANAGER_MANUAL_WITHDRAWAL_LABEL =
  'سحب يدوي من الإدارة من محفظة مسؤول القانونية'

export interface LegalManagerWalletRow {
  id: string
  legal_manager_user_id: string
  task_id: string
  debtor_id: string | null
  assigned_lawyer_id: string | null
  type: string
  amount: number
  notes: string | null
  created_by: string | null
  created_at: string
  creator?: { full_name?: string } | null
  debtor?: { full_name?: string } | null
  lawyer?: { full_name?: string } | null
}

const LEGAL_MANAGER_LEDGER_TYPES = new Set([
  LEGAL_MANAGER_PERCENTAGE_FEE_TYPE,
  LEGAL_MANAGER_BONUS_TYPE,
  'legal_manager_withdrawal',
  'legal_manager_manual_deposit',
  'legal_manager_manual_withdrawal',
])

const LM_TX_SELECT_BASE =
  'id, lawyer_id, type, wallet, amount, notes, reference_id, created_by, created_at, debtor_id'

const LM_TX_SELECT_WITH_JOINS = `${LM_TX_SELECT_BASE}, creator:profiles!lawyer_wallet_transactions_created_by_fkey(full_name), debtor:debtors(full_name)`

function pickProfileName(v: unknown): { full_name?: string } | null {
  if (!v) return null
  if (Array.isArray(v)) return (v[0] as { full_name?: string } | undefined) ?? null
  return v as { full_name?: string }
}

function legalManagerTxLabel(type: string): string {
  if (type === LEGAL_MANAGER_PERCENTAGE_FEE_TYPE) return 'نسبة 5% — اعتماد إنجاز'
  if (type === LEGAL_MANAGER_BONUS_TYPE) return 'إضافة مقابل اعتماد مهمة'
  if (type === 'legal_manager_withdrawal') return 'سحب معتمد'
  if (type === 'legal_manager_manual_deposit') return 'إيداع يدوي'
  if (type === 'legal_manager_manual_withdrawal') return 'سحب يدوي'
  return type
}

function legalManagerTxDescription(type: string, notes: string | null, lawyerName?: string | null): string {
  if (type === LEGAL_MANAGER_PERCENTAGE_FEE_TYPE || type === LEGAL_MANAGER_BONUS_TYPE) {
    return buildPercentageFeeLedgerNote(lawyerName, notes)
  }
  if (notes?.trim()) return notes.trim()
  if (type === 'legal_manager_withdrawal') return 'سحب معتمد — محفظة مسؤول القانونية'
  if (type === 'legal_manager_manual_deposit') return LEGAL_MANAGER_MANUAL_DEPOSIT_LABEL
  if (type === 'legal_manager_manual_withdrawal') return LEGAL_MANAGER_MANUAL_WITHDRAWAL_LABEL
  return '—'
}

function extractFeeAmountSuffix(notes: string | null): string {
  if (!notes) return ''
  const match = notes.match(/\([\d,\.]+\s*د\.ع\s*من\s*[\d,\.]+\s*د\.ع\)/)
  return match ? ` ${match[0]}` : ''
}

export function buildPercentageFeeLedgerNote(lawyerName: string | null | undefined, notes?: string | null): string {
  const suffix = extractFeeAmountSuffix(notes ?? null)
  const name = lawyerName?.trim()
  if (name) {
    return `نسبة 5% لمسؤول القانونية عند اعتماد إنجاز المهمة بواسطة (${name})${suffix}`
  }
  if (notes?.trim()) return notes.trim()
  return LEGAL_MANAGER_PERCENTAGE_FEE_NOTES
}

async function fetchLawyerNamesByTaskIds(
  supabase: SupabaseClient,
  taskIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const ids = [...new Set(taskIds.filter(Boolean))]
  if (!ids.length) return map

  const { data } = await supabase
    .from('tasks')
    .select('id, assigned_to, lawyer:profiles!tasks_assigned_to_fkey(full_name)')
    .in('id', ids)

  for (const row of data ?? []) {
    const lawyerRaw = (row as { lawyer?: unknown }).lawyer
    const lawyer = pickProfileName(lawyerRaw)
    if (lawyer?.full_name) map.set(row.id as string, lawyer.full_name)
  }
  return map
}

function unwrapTaskDef(raw: unknown): { fee_amount?: number; label?: string } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return (raw[0] as { fee_amount?: number; label?: string }) ?? null
  return raw as { fee_amount?: number; label?: string }
}

async function resolveTaskFeeForLegalManager(
  supabase: SupabaseClient,
  task: {
    reward_amount?: number | null
    task_definition_id?: string | null
    task_definitions?: unknown
  },
): Promise<number> {
  const fromReward = Number(task.reward_amount ?? 0)
  if (fromReward > 0) return fromReward

  const def = unwrapTaskDef(task.task_definitions)
  const fromDef = Number(def?.fee_amount ?? 0)
  if (fromDef > 0) return fromDef

  if (task.task_definition_id) {
    const { data } = await supabase
      .from('task_definitions')
      .select('fee_amount')
      .eq('id', task.task_definition_id)
      .maybeSingle()
    return Number(data?.fee_amount ?? 0)
  }
  return 0
}

function calcLegalManagerFeeFromTaskFee(taskFee: number): number {
  if (taskFee <= 0) return 0
  return Math.round(taskFee * LEGAL_MANAGER_FEE_RATE)
}

const APPROVED_STATUSES = ['approved', 'completed'] as const

function sumAmounts(rows: { amount?: number | null }[] | null | undefined): number {
  return (rows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0)
}

/** من يستلم النسبة: المعتمد إن كان مسؤول قانونية، وإلا مسؤول القانونية لفرع المهمة */
export async function resolveLegalManagerRecipient(
  supabase: SupabaseClient,
  reviewerId: string,
  taskBranchId: string | null,
): Promise<string | null> {
  const { data: reviewer } = await supabase
    .from('profiles')
    .select('id, role, branch_id, is_active')
    .eq('id', reviewerId)
    .maybeSingle()

  if (reviewer?.role === 'viewer' && reviewer.is_active !== false) {
    return reviewer.id
  }

  if (taskBranchId) {
    const { data: branchLm } = await supabase
      .from('profiles')
      .select('id')
      .eq('role', 'viewer')
      .eq('is_active', true)
      .eq('branch_id', taskBranchId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (branchLm?.id) return branchLm.id
  }

  const { data: fallback } = await supabase
    .from('profiles')
    .select('id')
    .eq('role', 'viewer')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return fallback?.id ?? null
}

async function findExistingBonusTx(
  supabase: SupabaseClient,
  taskId: string,
): Promise<{ id: string; amount: number } | null> {
  const { data } = await supabase
    .from('lawyer_wallet_transactions')
    .select('id, amount')
    .eq('reference_id', taskId)
    .eq('wallet', LEGAL_MANAGER_WALLET)
    .in('type', [LEGAL_MANAGER_PERCENTAGE_FEE_TYPE, LEGAL_MANAGER_BONUS_TYPE])
    .gt('amount', 0)
    .limit(1)
    .maybeSingle()
  return data ?? null
}

async function applyDebtorLegalManagerFeeDelta(
  supabase: SupabaseClient,
  debtorId: string,
  delta: number,
): Promise<{ ok: boolean; error?: string }> {
  if (delta === 0) return { ok: true }

  const { data: debtor, error: readErr } = await supabase
    .from('debtors')
    .select('legal_manager_fees, required_amount')
    .eq('id', debtorId)
    .single()

  if (readErr || !debtor) {
    return { ok: false, error: readErr?.message ?? 'المدين غير موجود' }
  }

  const newLmFees = Number(debtor.legal_manager_fees ?? 0) + delta

  const { error } = await supabase
    .from('debtors')
    .update({ legal_manager_fees: newLmFees } as Record<string, unknown>)
    .eq('id', debtorId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** مزامنة أتعاب مدير القانونية على المدين من درج المحفظة (إصلاح/تدقيق) */
export async function syncDebtorLegalManagerFees(
  supabase: SupabaseClient,
  debtorId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: txs, error: txErr } = await supabase
    .from('lawyer_wallet_transactions')
    .select('amount')
    .eq('debtor_id', debtorId)
    .eq('wallet', LEGAL_MANAGER_WALLET)

  if (txErr) return { ok: false, error: txErr.message }

  const target = sumAmounts(txs)

  const { data: debtor, error: readErr } = await supabase
    .from('debtors')
    .select('legal_manager_fees, required_amount')
    .eq('id', debtorId)
    .single()

  if (readErr || !debtor) {
    return { ok: false, error: readErr?.message ?? 'المدين غير موجود' }
  }

  const { error } = await supabase
    .from('debtors')
    .update({
      legal_manager_fees: target,
    } as Record<string, unknown>)
    .eq('id', debtorId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function fetchLegalManagerWalletBalance(
  supabase: SupabaseClient,
  legalManagerUserId: string,
): Promise<number> {
  const { fetchLawyerWalletBalance } = await import('@/lib/lawyer-wallet')
  return fetchLawyerWalletBalance(supabase, legalManagerUserId, LEGAL_MANAGER_WALLET)
}

export async function fetchLegalManagerWalletTransactions(
  supabase: SupabaseClient,
  legalManagerUserId: string,
  limit = 100,
): Promise<LegalManagerWalletRow[]> {
  let q = supabase
    .from('lawyer_wallet_transactions')
    .select(LM_TX_SELECT_WITH_JOINS)
    .eq('lawyer_id', legalManagerUserId)
    .eq('wallet', LEGAL_MANAGER_WALLET)
    .order('created_at', { ascending: false })
    .limit(limit)

  let { data, error } = await q
  let rows: Record<string, unknown>[]

  if (error) {
    const fallback = await supabase
      .from('lawyer_wallet_transactions')
      .select(LM_TX_SELECT_BASE)
      .eq('lawyer_id', legalManagerUserId)
      .eq('wallet', LEGAL_MANAGER_WALLET)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (fallback.error) {
      console.error('[legal-manager-wallet] fetch transactions:', fallback.error.message)
      return []
    }
    rows = (fallback.data ?? []) as Record<string, unknown>[]
  } else {
    rows = (data ?? []) as Record<string, unknown>[]
  }

  return rows.map(row => {
    const r = row
    return {
      id: r.id as string,
      legal_manager_user_id: r.lawyer_id as string,
      task_id: (r.reference_id as string) ?? '',
      debtor_id: (r.debtor_id as string | null) ?? null,
      assigned_lawyer_id: null,
      type: r.type as string,
      amount: Number(r.amount),
      notes: (r.notes as string | null) ?? null,
      created_by: (r.created_by as string | null) ?? null,
      created_at: r.created_at as string,
      creator: pickProfileName(r.creator),
      debtor: pickProfileName(r.debtor),
      lawyer: null,
    }
  })
}

export async function listActiveLegalManagers(
  supabase: SupabaseClient,
): Promise<{ id: string; full_name: string; branch_id: string | null }[]> {
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, branch_id')
    .eq('role', 'viewer')
    .eq('is_active', true)
    .order('full_name')

  return data ?? []
}

export type LegalManagerLedgerRow = {
  id: string
  created_at: string
  label: string
  description: string
  amount: number
  balanceAfter: number
  performedBy?: string | null
  isWalletMovement: boolean
}

export type LegalManagerLedgerResult = {
  rows: LegalManagerLedgerRow[]
  movementCount: number
}

export async function fetchLegalManagerLedger(
  supabase: SupabaseClient,
  legalManagerUserId: string,
): Promise<LegalManagerLedgerResult> {
  const [txs, payoutReqs] = await Promise.all([
    fetchLegalManagerWalletTransactions(supabase, legalManagerUserId, 500),
    fetchLegalManagerPayoutRequests(supabase, legalManagerUserId, 200),
  ])

  const feeTaskIds = txs
    .filter(tx =>
      (tx.type === LEGAL_MANAGER_PERCENTAGE_FEE_TYPE || tx.type === LEGAL_MANAGER_BONUS_TYPE)
      && tx.task_id,
    )
    .map(tx => tx.task_id)
  const lawyerByTask = await fetchLawyerNamesByTaskIds(supabase, feeTaskIds)

  type LedgerEvent = {
    id: string
    created_at: string
    label: string
    description: string
    amount: number
    affectsBalance: boolean
    performedBy?: string | null
  }

  const events: LedgerEvent[] = []

  for (const tx of txs) {
    if (!LEGAL_MANAGER_LEDGER_TYPES.has(tx.type)) continue
    events.push({
      id: tx.id,
      created_at: tx.created_at,
      label: legalManagerTxLabel(tx.type),
      description: legalManagerTxDescription(
        tx.type,
        tx.notes,
        tx.task_id ? lawyerByTask.get(tx.task_id) : null,
      ),
      amount: Number(tx.amount),
      affectsBalance: true,
      performedBy: tx.creator?.full_name ?? null,
    })
  }

  for (const req of payoutReqs) {
    const amt = Number(req.amount)
    const baseDesc = req.title + (req.notes ? ` · ${req.notes}` : '')
    if (req.status === 'pending') {
      events.push({
        id: `pending-${req.id}`,
        created_at: req.created_at,
        label: 'طلب سحب',
        description: baseDesc,
        amount: -amt,
        affectsBalance: false,
      })
    } else if (req.status === 'rejected') {
      events.push({
        id: `rejected-${req.id}`,
        created_at: req.reviewed_at ?? req.created_at,
        label: 'طلب سحب مرفوض',
        description: baseDesc + (req.review_notes ? ` · ${req.review_notes}` : ''),
        amount: 0,
        affectsBalance: false,
      })
    }
  }

  events.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  let balance = 0
  const withBalance: LegalManagerLedgerRow[] = events.map(ev => {
    if (ev.affectsBalance) balance += ev.amount
    return {
      id: ev.id,
      created_at: ev.created_at,
      label: ev.label,
      description: ev.description,
      amount: ev.amount,
      balanceAfter: balance,
      performedBy: ev.performedBy ?? null,
      isWalletMovement: ev.affectsBalance,
    }
  })

  const movementCount = withBalance.filter(r => r.isWalletMovement).length

  return { rows: withBalance.reverse(), movementCount }
}

export async function fetchLegalManagerAvailableBalance(
  supabase: SupabaseClient,
  legalManagerUserId: string,
): Promise<number> {
  const { fetchLawyerAvailablePayoutBalance } = await import('@/lib/lawyer-payout-requests')
  return fetchLawyerAvailablePayoutBalance(supabase, legalManagerUserId, LEGAL_MANAGER_WALLET)
}

export async function fetchLegalManagerPayoutRequests(
  supabase: SupabaseClient,
  legalManagerUserId: string,
  limit = 50,
) {
  const all = await fetchLawyerPayoutRequests(supabase, legalManagerUserId, limit)
  return all.filter(r => (r.wallet_kind ?? 'fees') === LEGAL_MANAGER_WALLET)
}

async function assertActiveLegalManager(
  supabase: SupabaseClient,
  legalManagerUserId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', legalManagerUserId)
    .single()

  if (error || !profile) return { ok: false, error: 'مسؤول القانونية غير موجود' }
  if (profile.role !== 'viewer' || profile.is_active === false) {
    return { ok: false, error: 'المستخدم ليس مدير قانونية نشطاً' }
  }
  return { ok: true }
}

/** إيداع يدوي — الإدارة فقط */
export async function manualDepositLegalManagerWallet(
  supabase: SupabaseClient,
  params: {
    legalManagerUserId: string
    amount: number
    notes: string
    createdBy: string
  },
): Promise<{ ok: boolean; error?: string; newBalance?: number }> {
  if (params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }
  const note = params.notes.trim()
  if (!note) return { ok: false, error: 'الملاحظة مطلوبة' }

  const check = await assertActiveLegalManager(supabase, params.legalManagerUserId)
  if (!check.ok) return check

  const result = await insertWalletTransaction(supabase, {
    lawyer_id: params.legalManagerUserId,
    type: 'legal_manager_manual_deposit',
    wallet: LEGAL_MANAGER_WALLET,
    amount: params.amount,
    notes: note,
    created_by: params.createdBy,
  })
  if (!result.ok) return { ok: false, error: result.error }

  const newBalance = await fetchLegalManagerWalletBalance(supabase, params.legalManagerUserId)
  return { ok: true, newBalance }
}

/** سحب يدوي — الإدارة فقط */
export async function manualWithdrawLegalManagerWallet(
  supabase: SupabaseClient,
  params: {
    legalManagerUserId: string
    amount: number
    notes: string
    createdBy: string
  },
): Promise<{ ok: boolean; error?: string; newBalance?: number }> {
  if (params.amount <= 0) return { ok: false, error: 'المبلغ يجب أن يكون أكبر من صفر' }
  const note = params.notes.trim()
  if (!note) return { ok: false, error: 'الملاحظة مطلوبة' }

  const check = await assertActiveLegalManager(supabase, params.legalManagerUserId)
  if (!check.ok) return check

  const balance = await fetchLegalManagerWalletBalance(supabase, params.legalManagerUserId)
  if (params.amount > balance) {
    return {
      ok: false,
      error: `رصيد المحفظة غير كافٍ — المتاح: ${formatMoney(balance)}`,
    }
  }

  const result = await insertWalletTransaction(supabase, {
    lawyer_id: params.legalManagerUserId,
    type: 'legal_manager_manual_withdrawal',
    wallet: LEGAL_MANAGER_WALLET,
    amount: -params.amount,
    notes: note,
    created_by: params.createdBy,
  })
  if (!result.ok) return { ok: false, error: result.error }

  return { ok: true, newBalance: balance - params.amount }
}

/**
 * إضافة نسبة 5% من أتعاب المهمة لمحفظة مسؤول القانونية عند اعتماد الإنجاز.
 * idempotent: مرة واحدة لكل task_id.
 */
export async function creditLegalManagerBonusOnApproval(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
): Promise<{
  ok: boolean
  amount: number
  alreadyCredited?: boolean
  skipped?: boolean
  reason?: string
  error?: string
}> {
  const existing = await findExistingBonusTx(supabase, taskId)
  if (existing) {
    const { data: taskLite } = await supabase.from('tasks').select('debtor_id').eq('id', taskId).maybeSingle()
    if (taskLite?.debtor_id) await syncDebtorLegalManagerFees(supabase, taskLite.debtor_id as string)
    return { ok: true, amount: 0, alreadyCredited: true }
  }

  const { data: task, error: taskErr } = await supabase
    .from('tasks')
    .select('id, task_status, debtor_id, branch_id, task_definition_id, assigned_to, reward_amount, task_definitions(fee_amount, label)')
    .eq('id', taskId)
    .single()

  if (taskErr || !task) {
    return { ok: false, amount: 0, error: taskErr?.message ?? 'المهمة غير موجودة' }
  }

  if (!APPROVED_STATUSES.includes(task.task_status as typeof APPROVED_STATUSES[number])) {
    return { ok: false, amount: 0, error: 'لا تُضاف المكافأة إلا بعد اعتماد المهمة' }
  }

  const assignedLawyerId = taskLawyerId(task as { assigned_to?: string | null; lawyer_id?: string | null })
  const debtorId = task.debtor_id as string | null

  if (!assignedLawyerId || !debtorId) {
    return {
      ok: true,
      amount: 0,
      skipped: true,
      reason: 'المهمة بدون محامٍ أو مدين — لا نسبة لمسؤول القانونية',
    }
  }

  // بنية قابلة لإضافة عمولة الجزائيات لاحقاً — حالياً لا حركة مالية للجزائي
  const { data: debtorCase } = await supabase
    .from('debtors')
    .select('case_type')
    .eq('id', debtorId)
    .maybeSingle()
  if (debtorCase?.case_type === 'criminal') {
    return {
      ok: true,
      amount: 0,
      skipped: true,
      reason: 'لا عمولة لمسؤول الجزائيات على مهام المدين الجزائي (مؤجّل)',
    }
  }

  const recipientId = await resolveLegalManagerRecipient(
    supabase,
    reviewerId,
    (task.branch_id as string | null) ?? null,
  )

  if (!recipientId) {
    console.warn(
      `[legal-manager-wallet] لا يوجد مسؤول قانونية لفرع المهمة ${task.branch_id ?? '—'} — task ${taskId}`,
    )
    return {
      ok: true,
      amount: 0,
      skipped: true,
      reason: 'لا يوجد مسؤول قانونية مرتبط بالفرع',
    }
  }

  const taskFee = await resolveTaskFeeForLegalManager(supabase, task)
  const amount = calcLegalManagerFeeFromTaskFee(taskFee)

  if (amount <= 0) {
    return {
      ok: true,
      amount: 0,
      skipped: true,
      reason: 'لا أتعاب للمهمة — لا نسبة لمسؤول القانونية',
    }
  }

  const { data: lawyerProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', assignedLawyerId)
    .maybeSingle()
  const lawyerName = (lawyerProfile?.full_name as string | undefined)?.trim() || 'المكلّف بالمهمة'

  const feeNotes = buildPercentageFeeLedgerNote(
    lawyerName,
    `(${formatMoney(amount)} من ${formatMoney(taskFee)})`,
  )

  let insertResult = await insertWalletTransaction(supabase, {
    lawyer_id: recipientId,
    type: LEGAL_MANAGER_PERCENTAGE_FEE_TYPE,
    wallet: LEGAL_MANAGER_WALLET,
    amount,
    notes: feeNotes,
    reference_id: taskId,
    created_by: reviewerId,
    debtor_id: debtorId,
    task_definition_id: task.task_definition_id ?? null,
    source: 'task_completion',
  })

  if (!insertResult.ok && insertResult.typeRejected) {
    insertResult = await insertWalletTransaction(supabase, {
      lawyer_id: recipientId,
      type: LEGAL_MANAGER_BONUS_TYPE,
      wallet: LEGAL_MANAGER_WALLET,
      amount,
      notes: feeNotes,
      reference_id: taskId,
      created_by: reviewerId,
      debtor_id: debtorId,
      task_definition_id: task.task_definition_id ?? null,
      source: 'task_completion',
    })
  }

  if (!insertResult.ok) {
    if (insertResult.error?.includes('duplicate') || insertResult.error?.includes('23505')) {
      await syncDebtorLegalManagerFees(supabase, debtorId)
      return { ok: true, amount: 0, alreadyCredited: true }
    }
    const verify = await findExistingBonusTx(supabase, taskId)
    if (verify) {
      await syncDebtorLegalManagerFees(supabase, debtorId)
      return { ok: true, amount: 0, alreadyCredited: true }
    }
    return { ok: false, amount: 0, error: insertResult.error ?? 'فشل تسجيل حركة محفظة مسؤول القانونية' }
  }

  const debtorUpdate = await applyDebtorLegalManagerFeeDelta(supabase, debtorId, amount)
  if (!debtorUpdate.ok) {
    console.error('[legal-manager-wallet] debtor update failed:', debtorUpdate.error)
    return { ok: false, amount: 0, error: debtorUpdate.error ?? 'فشل تحديث حساب المدين' }
  }

  await logActivity(
    {
      action: 'legal_manager_task_bonus',
      entity_type: 'task',
      entity_id: taskId,
      description: feeNotes,
      metadata: {
        legal_manager_user_id: recipientId,
        lawyer_id: assignedLawyerId,
        debtor_id: debtorId,
        amount,
        branch_id: task.branch_id,
        wallet: LEGAL_MANAGER_WALLET,
      },
    },
    supabase,
  )

  return { ok: true, amount }
}
