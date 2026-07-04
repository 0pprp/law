import type { SupabaseClient } from '@supabase/supabase-js'
import type { LawyerWalletKind } from '@/lib/types'
import { taskLawyerId } from '@/lib/task-assignment'
import { logActivity } from '@/lib/activity-log'
import { insertWalletTransaction } from '@/lib/lawyer-wallet'
import { fetchLawyerPayoutRequests } from '@/lib/lawyer-payout-requests'
import { formatMoney } from '@/lib/money-input'

/** مكافأة ثابتة لمدير القانونية عند اعتماد كل إنجاز (د.ع) */
export const LEGAL_MANAGER_TASK_BONUS = 1000

export const LEGAL_MANAGER_WALLET: LawyerWalletKind = 'legal_manager'

export const LEGAL_MANAGER_BONUS_TYPE = 'legal_manager_task_bonus' as const

export const LEGAL_MANAGER_BONUS_NOTES =
  'إضافة 1,000 د.ع إلى محفظة مدير القانونية مقابل اعتماد إنجاز مهمة'

export const LEGAL_MANAGER_MANUAL_DEPOSIT_LABEL =
  'إيداع يدوي من الإدارة إلى محفظة مدير القانونية'

export const LEGAL_MANAGER_MANUAL_WITHDRAWAL_LABEL =
  'سحب يدوي من الإدارة من محفظة مدير القانونية'

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

const APPROVED_STATUSES = ['approved', 'completed'] as const

function sumAmounts(rows: { amount?: number | null }[] | null | undefined): number {
  return (rows ?? []).reduce((s, r) => s + Number(r.amount ?? 0), 0)
}

/** من يستلم المكافأة: المعتمد إن كان مدير قانونية، وإلا مدير القانونية لفرع المهمة */
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
  const newRequired = Number(debtor.required_amount ?? 0) + delta

  const { error } = await supabase
    .from('debtors')
    .update({ legal_manager_fees: newLmFees, required_amount: newRequired } as Record<string, unknown>)
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

  const current = Number(debtor.legal_manager_fees ?? 0)
  const delta = target - current
  if (delta === 0) return { ok: true }

  const { error } = await supabase
    .from('debtors')
    .update({
      legal_manager_fees: target,
      required_amount: Number(debtor.required_amount ?? 0) + delta,
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
  const { data, error } = await supabase
    .from('lawyer_wallet_transactions')
    .select(`
      id, lawyer_id, type, wallet, amount, notes, reference_id, created_by, created_at, debtor_id,
      creator:profiles!lawyer_wallet_transactions_created_by_fkey(full_name),
      debtor:debtors(full_name),
      task:tasks(assigned_to, lawyer:profiles!tasks_assigned_to_fkey(full_name))
    `)
    .eq('lawyer_id', legalManagerUserId)
    .eq('wallet', LEGAL_MANAGER_WALLET)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) return []

  return (data ?? []).map(row => {
    const r = row as Record<string, unknown>
    const taskRaw = r.task
    const task = Array.isArray(taskRaw) ? taskRaw[0] : taskRaw
    const taskLawyer = task && typeof task === 'object'
      ? (Array.isArray((task as { lawyer?: unknown }).lawyer)
        ? (task as { lawyer: { full_name?: string }[] }).lawyer[0]
        : (task as { lawyer?: { full_name?: string } }).lawyer)
      : null
    const pickName = (v: unknown) => {
      if (!v) return null
      if (Array.isArray(v)) return (v[0] as { full_name?: string } | undefined) ?? null
      return v as { full_name?: string }
    }
    return {
      id: r.id as string,
      legal_manager_user_id: r.lawyer_id as string,
      task_id: (r.reference_id as string) ?? '',
      debtor_id: (r.debtor_id as string | null) ?? null,
      assigned_lawyer_id: task && typeof task === 'object' ? ((task as { assigned_to?: string }).assigned_to ?? null) : null,
      type: r.type as string,
      amount: Number(r.amount),
      notes: (r.notes as string | null) ?? null,
      created_by: (r.created_by as string | null) ?? null,
      created_at: r.created_at as string,
      creator: pickName(r.creator),
      debtor: pickName(r.debtor),
      lawyer: taskLawyer ?? null,
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

/** كشف محفظة مدير القانونية مع الرصيد بعد كل حركة */
export async function fetchLegalManagerLedger(
  supabase: SupabaseClient,
  legalManagerUserId: string,
): Promise<LegalManagerLedgerRow[]> {
  const [txs, payoutReqs] = await Promise.all([
    fetchLegalManagerWalletTransactions(supabase, legalManagerUserId, 500),
    fetchLegalManagerPayoutRequests(supabase, legalManagerUserId, 200),
  ])

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
    if (tx.type === LEGAL_MANAGER_BONUS_TYPE) {
      events.push({
        id: tx.id,
        created_at: tx.created_at,
        label: 'إضافة مقابل اعتماد مهمة',
        description: tx.notes ?? LEGAL_MANAGER_BONUS_NOTES,
        amount: Number(tx.amount),
        affectsBalance: true,
        performedBy: tx.creator?.full_name ?? null,
      })
    } else if (tx.type === 'legal_manager_withdrawal') {
      events.push({
        id: tx.id,
        created_at: tx.created_at,
        label: 'سحب معتمد',
        description: tx.notes ?? 'سحب معتمد — محفظة مدير القانونية',
        amount: Number(tx.amount),
        affectsBalance: true,
        performedBy: tx.creator?.full_name ?? null,
      })
    } else if (tx.type === 'legal_manager_manual_deposit') {
      events.push({
        id: tx.id,
        created_at: tx.created_at,
        label: 'إيداع يدوي',
        description: tx.notes ?? LEGAL_MANAGER_MANUAL_DEPOSIT_LABEL,
        amount: Number(tx.amount),
        affectsBalance: true,
        performedBy: tx.creator?.full_name ?? null,
      })
    } else if (tx.type === 'legal_manager_manual_withdrawal') {
      events.push({
        id: tx.id,
        created_at: tx.created_at,
        label: 'سحب يدوي',
        description: tx.notes ?? LEGAL_MANAGER_MANUAL_WITHDRAWAL_LABEL,
        amount: Number(tx.amount),
        affectsBalance: true,
        performedBy: tx.creator?.full_name ?? null,
      })
    }
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
    }
  })

  return withBalance.reverse()
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

  if (error || !profile) return { ok: false, error: 'مدير القانونية غير موجود' }
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
 * إضافة 1,000 د.ع لدرج محفظة مدير القانونية (داخل lawyer_wallet_transactions) عند اعتماد الإنجاز.
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
    .select('id, task_status, debtor_id, branch_id, task_definition_id, assigned_to, lawyer_id')
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
      reason: 'المهمة بدون محامٍ أو مدين — لا مكافأة لمدير القانونية',
    }
  }

  const recipientId = await resolveLegalManagerRecipient(
    supabase,
    reviewerId,
    (task.branch_id as string | null) ?? null,
  )

  if (!recipientId) {
    console.warn(
      `[legal-manager-wallet] لا يوجد مدير قانونية لفرع المهمة ${task.branch_id ?? '—'} — task ${taskId}`,
    )
    return {
      ok: true,
      amount: 0,
      skipped: true,
      reason: 'لا يوجد مدير قانونية مرتبط بالفرع',
    }
  }

  const amount = LEGAL_MANAGER_TASK_BONUS

  const insertResult = await insertWalletTransaction(supabase, {
    lawyer_id: recipientId,
    type: LEGAL_MANAGER_BONUS_TYPE,
    wallet: LEGAL_MANAGER_WALLET,
    amount,
    notes: LEGAL_MANAGER_BONUS_NOTES,
    reference_id: taskId,
    created_by: reviewerId,
    debtor_id: debtorId,
    task_definition_id: task.task_definition_id ?? null,
    source: 'task_completion',
  })

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
    return { ok: false, amount: 0, error: insertResult.error ?? 'فشل تسجيل حركة محفظة مدير القانونية' }
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
      description: LEGAL_MANAGER_BONUS_NOTES,
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
