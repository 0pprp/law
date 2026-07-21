import type { SupabaseClient } from '@supabase/supabase-js'
import { taskLawyerId } from '@/lib/task-assignment'

function unwrapTaskDef(raw: unknown): { fee_amount?: number; label?: string } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return (raw[0] as { fee_amount?: number; label?: string }) ?? null
  return raw as { fee_amount?: number; label?: string }
}

const APPROVED_STATUSES = new Set(['approved', 'completed'])
const FEE_TX_TYPES = ['approved_task_payment', 'manual_adjustment', 'task_fee'] as const

/**
 * المرحلة الأولى تمت (اعتماد الإنجاز) — الأتعاب لم تُحتسب بعد.
 * القيمة موجودة أصلاً في قيد tasks_fee_status_check في القاعدة.
 */
export const FEE_STATUS_AWAITING_NEXT_TASK = 'approved_pending_next'
/** الاعتماد النهائي تمّ واحتُسبت الأتعاب — القيمة الموجودة في القاعدة (بدل released) */
export const FEE_STATUS_PAYABLE = 'payable'

/** Task fee = reward_amount on the task (what the debtor owes), not catalog max. */
async function resolveTaskFeeAmount(
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

async function markFeeReleased(supabase: SupabaseClient, taskId: string) {
  // القاعدة تقبل: pending | approved_pending_next | payable (لا released)
  const { error } = await supabase.from('tasks').update({ fee_status: FEE_STATUS_PAYABLE } as any).eq('id', taskId)
  if (error && !error.message.includes('fee_status')) {
    console.warn('[markFeeReleased]', error.message)
  }
}

async function findTaskFeeTransaction(
  supabase: SupabaseClient,
  taskId: string,
): Promise<{ id: string; amount: number } | null> {
  const { data: withWallet } = await supabase
    .from('lawyer_wallet_transactions')
    .select('id, amount')
    .eq('reference_id', taskId)
    .eq('wallet', 'fees')
    .gt('amount', 0)
    .in('type', [...FEE_TX_TYPES])
    .limit(1)
    .maybeSingle()

  if (withWallet) return withWallet

  const { data: anyWallet } = await supabase
    .from('lawyer_wallet_transactions')
    .select('id, amount')
    .eq('reference_id', taskId)
    .gt('amount', 0)
    .in('type', [...FEE_TX_TYPES])
    .limit(1)
    .maybeSingle()

  return anyWallet ?? null
}

async function sumApprovedTaskFeesForDebtor(
  supabase: SupabaseClient,
  debtorId: string,
): Promise<number> {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('reward_amount, task_definition_id, task_definitions(fee_amount)')
    .eq('debtor_id', debtorId)
    .in('task_status', [...APPROVED_STATUSES])

  let total = 0
  for (const task of tasks ?? []) {
    total += await resolveTaskFeeAmount(supabase, task)
  }
  return total
}

async function syncDebtorLawyerFees(
  supabase: SupabaseClient,
  debtorId: string,
): Promise<{ ok: boolean; error?: string }> {
  const target = await sumApprovedTaskFeesForDebtor(supabase, debtorId)
  const { error } = await supabase
    .from('debtors')
    .update({ lawyer_fees: target } as any)
    .eq('id', debtorId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Credit lawyer fee + update debtor account on task approval.
 * Idempotent: one fee credit per task (wallet reference_id + fee_status).
 */
export async function creditTaskFeeOnApproval(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
): Promise<{ ok: boolean; amount: number; error?: string; alreadyCredited?: boolean }> {
  const fullSelect = `
      id,
      assigned_to,
      reward_amount,
      fee_status,
      task_status,
      task_definition_id,
      task_type,
      debtor_id,
      branch_id,
      task_definitions(fee_amount, label)
    `

  let task: Record<string, unknown> | null = null
  let taskErr: { message?: string } | null = null

  const { data: fullTask, error: fullErr } = await supabase
    .from('tasks')
    .select(fullSelect)
    .eq('id', taskId)
    .single()

  if (fullErr?.message?.includes('fee_status')) {
    const { data: liteTask, error: liteErr } = await supabase
      .from('tasks')
      .select(`
        id,
        assigned_to,
        reward_amount,
        task_status,
        task_definition_id,
        task_type,
        debtor_id,
        branch_id,
        task_definitions(fee_amount, label)
      `)
      .eq('id', taskId)
      .single()
    task = liteTask as Record<string, unknown> | null
    taskErr = liteErr
  } else {
    task = fullTask as Record<string, unknown> | null
    taskErr = fullErr
  }

  if (taskErr || !task) {
    return { ok: false, amount: 0, error: taskErr?.message ?? 'المهمة غير موجودة' }
  }

  const status = task.task_status as string
  if (status === 'rejected' || status === 'needs_revision' || status === 'needs_info') {
    return { ok: false, amount: 0, error: 'لا تُضاف أتعاب لمهمة مرفوضة' }
  }

  if (!APPROVED_STATUSES.has(status)) {
    return { ok: false, amount: 0, error: 'لا تُضاف الأتعاب إلا بعد اعتماد المهمة' }
  }

  // مرحلتان: لا صرف أتعاب أثناء انتظار إنشاء المهمة التالية
  const feeStatus = task.fee_status as string | null | undefined
  if (feeStatus === FEE_STATUS_AWAITING_NEXT_TASK) {
    return {
      ok: false,
      amount: 0,
      error: 'لا تُحتسب الأتعاب قبل إنشاء المهمة التالية أو إغلاق القضية',
    }
  }

  const existingTx = await findTaskFeeTransaction(supabase, taskId)

  if (existingTx) {
    const debtorId = task.debtor_id as string | null
    if (debtorId) {
      await syncDebtorLawyerFees(supabase, debtorId)
      const { syncDebtorLegalManagerFees } = await import('@/lib/legal-manager-wallet')
      await syncDebtorLegalManagerFees(supabase, debtorId)
    }
    await markFeeReleased(supabase, taskId)
    return { ok: true, amount: 0, alreadyCredited: true }
  }

  const lawyerId = taskLawyerId(task as { assigned_to?: string | null; lawyer_id?: string | null })
  const debtorId = task.debtor_id as string | null

  // الجزائي: أجر المهمة دائماً 0 — لا إيداع أتعاب حتى لو أُرسل مبلغ من الواجهة
  let amount = 0
  if (debtorId) {
    const { data: debtorRow } = await supabase
      .from('debtors')
      .select('case_type')
      .eq('id', debtorId)
      .maybeSingle()
    if (debtorRow?.case_type === 'criminal') {
      amount = 0
    } else {
      amount = await resolveTaskFeeAmount(supabase, task)
    }
  } else {
    amount = await resolveTaskFeeAmount(supabase, task)
  }

  const def = unwrapTaskDef(task.task_definitions)
  const taskLabel = def?.label ?? (task.task_type as string) ?? 'مهمة'

  if (amount <= 0 || !lawyerId) {
    if (debtorId) await syncDebtorLawyerFees(supabase, debtorId)
    await markFeeReleased(supabase, taskId)
    return { ok: true, amount: 0 }
  }

  if (!debtorId) {
    return { ok: false, amount: 0, error: 'المهمة غير مرتبطة بمدين' }
  }

  let walletCredited = 0

  if (!existingTx) {
    const { creditLawyerWallet } = await import('@/lib/lawyer-wallet')
    const walletResult = await creditLawyerWallet(supabase, {
      lawyerId,
      amount,
      type: 'approved_task_payment',
      wallet: 'fees',
      notes: `أتعاب إنجاز مهمة: ${taskLabel}`,
      createdBy: reviewerId,
      referenceId: taskId,
    })

    if (!walletResult.ok) {
      return { ok: false, amount: 0, error: walletResult.error ?? 'فشل إضافة الأتعاب لمحفظة المحامي' }
    }

    const verifyTx = await findTaskFeeTransaction(supabase, taskId)
    if (!verifyTx) {
      return { ok: false, amount: 0, error: 'تمت المحاولة لكن لم تُسجَّل حركة محفظة الأتعاب' }
    }
    walletCredited = amount
  }

  const syncResult = await syncDebtorLawyerFees(supabase, debtorId)
  if (!syncResult.ok) {
    return { ok: false, amount: 0, error: syncResult.error ?? 'فشل تحديث أتعاب المحامين في كشف المدين' }
  }

  await markFeeReleased(supabase, taskId)
  return { ok: true, amount: walletCredited }
}

export type ApproveTaskResult = {
  ok: boolean
  feeAmount: number
  legalManagerBonus?: number
  error?: string
}

export function parseGps(val: string): { lat: number; lng: number } | null {
  if (!val) return null
  const parts = val.split(',').map(s => parseFloat(s.trim()))
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    if (parts[0] >= -90 && parts[0] <= 90 && parts[1] >= -180 && parts[1] <= 180) {
      return { lat: parts[0], lng: parts[1] }
    }
  }
  return null
}

export function extractGpsFromCompletion(
  completionData: Record<string, string> | null | undefined,
  gpsKeys: string[],
): { lat: number; lng: number } | null {
  if (!completionData || !gpsKeys.length) return null
  for (const key of gpsKeys) {
    const parsed = parseGps(completionData[key])
    if (parsed) return parsed
  }
  return null
}

/** Wallet balance via SQL aggregate — avoids fetching all rows. */
export async function fetchLawyerWalletBalance(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<number> {
  const { fetchLawyerWalletBalance: getBalance } = await import('@/lib/lawyer-wallet')
  return getBalance(supabase, lawyerId)
}

/** @deprecated Fees are credited on approval — kept idempotent for legacy API calls. */
export async function releaseLawyerFee(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
): Promise<{ ok: boolean; amount: number; error?: string }> {
  const result = await creditTaskFeeOnApproval(supabase, taskId, reviewerId)
  return { ok: result.ok, amount: result.amount, error: result.error }
}

/**
 * المرحلة الأولى — اعتماد إنجاز المهمة فقط:
 * status → approved + fee_status → approved_pending_next.
 * لا أتعاب، لا خصم صرفيات، لا حركة مالية — كل ذلك في finalizeTaskApproval
 * بعد نجاح إنشاء المهمة التالية (أو إغلاق القضية).
 */
export async function approveTaskCompletion(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
): Promise<ApproveTaskResult> {
  const { data: task } = await supabase
    .from('tasks')
    .select('id, task_status, completed_at, fee_status, assigned_to')
    .eq('id', taskId)
    .single()

  if (!task) {
    return { ok: false, feeAmount: 0, error: 'المهمة غير موجودة' }
  }

  if (task.task_status === 'rejected' || task.task_status === 'needs_revision' || task.task_status === 'needs_info') {
    return { ok: false, feeAmount: 0, error: 'لا يمكن اعتماد مهمة مرفوضة — أعد إرسالها أولاً' }
  }

  // idempotent: معتمدة مسبقاً — لا نكرر شيئاً
  if (APPROVED_STATUSES.has(task.task_status)) {
    return { ok: true, feeAmount: 0, legalManagerBonus: 0 }
  }

  // لا اعتماد إلا من طابور المراجعة (مُنجَزة / بانتظار المراجعة)
  if (task.task_status !== 'submitted' && task.task_status !== 'pending_review') {
    return { ok: false, feeAmount: 0, error: 'لا يمكن اعتماد المهمة قبل إرسال الإنجاز للمراجعة' }
  }

  // فحص مبكر لرصيد الصرفيات (قراءة فقط — لا خصم في هذه المرحلة)
  let assigneeRole: string | null = null
  if (task.assigned_to) {
    const { data: assignee } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', task.assigned_to)
      .maybeSingle()
    assigneeRole = assignee?.role ?? null
  }
  if (assigneeRole !== 'delegate') {
    const { checkDisbursementBalanceForTask } = await import('@/lib/expense-wallet')
    const balanceCheck = await checkDisbursementBalanceForTask(supabase, taskId)
    if (!balanceCheck.ok && balanceCheck.required > 0) {
      return { ok: false, feeAmount: 0, error: balanceCheck.error ?? 'رصيد محفظة الصرفيات للمحامي غير كافٍ' }
    }
  }

  // مَن اعتمد ومتى: يُسجَّل في Activity Log (approve_task) وفي حركات المحفظة عند الاعتماد النهائي
  void reviewerId
  const approvedAt = task.completed_at ?? new Date().toISOString()
  const { data: approvedRows, error: approveErr } = await supabase
    .from('tasks')
    .update({
      task_status: 'approved',
      completed_at: approvedAt,
      fee_status: FEE_STATUS_AWAITING_NEXT_TASK,
    } as any)
    .eq('id', taskId)
    .in('task_status', ['submitted', 'pending_review'])
    .select('id')

  if (approveErr) {
    if (approveErr.message?.includes('fee_status')) {
      return { ok: false, feeAmount: 0, error: 'عمود fee_status غير موجود — شغّل scripts/apply-wallet-migrations.sql أولاً' }
    }
    return { ok: false, feeAmount: 0, error: approveErr.message }
  }
  if (!approvedRows?.length) {
    return { ok: false, feeAmount: 0, error: 'تغيّرت حالة المهمة — أعد التحميل' }
  }

  return { ok: true, feeAmount: 0, legalManagerBonus: 0 }
}

export type FinalizeTaskResult = {
  ok: boolean
  feeAmount: number
  legalManagerBonus: number
  alreadyFinalized?: boolean
  error?: string
}

/**
 * المرحلة الثانية — الاعتماد النهائي واحتساب الأتعاب.
 * تُستدعى فقط بعد نجاح إنشاء المهمة التالية أو إغلاق القضية.
 * القفل الذري: fee_status approved_pending_next → payable (قبل الاحتساب).
 * عند الفشل يُعاد approved_pending_next. حركات المحفظة idempotent عبر reference_id.
 */
export async function finalizeTaskApproval(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
): Promise<FinalizeTaskResult> {
  const { data: task } = await supabase
    .from('tasks')
    .select('id, task_status, fee_status, assigned_to')
    .eq('id', taskId)
    .single()

  if (!task) {
    return { ok: false, feeAmount: 0, legalManagerBonus: 0, error: 'المهمة غير موجودة' }
  }
  if (!APPROVED_STATUSES.has(task.task_status)) {
    return { ok: false, feeAmount: 0, legalManagerBonus: 0, error: 'لا اعتماد نهائي قبل اعتماد الإنجاز' }
  }

  // مهام قديمة (payable/null/غير awaiting): لا تكرار — أتعابها إما احتُسبت أو خارج هذا المسار
  if (task.fee_status !== FEE_STATUS_AWAITING_NEXT_TASK) {
    return { ok: true, feeAmount: 0, legalManagerBonus: 0, alreadyFinalized: true }
  }

  // قفل ذري: الفائز الوحيد بالتحديث المشروط يكمل الاحتساب
  const { data: claimed, error: claimErr } = await supabase
    .from('tasks')
    .update({ fee_status: FEE_STATUS_PAYABLE } as any)
    .eq('id', taskId)
    .eq('fee_status', FEE_STATUS_AWAITING_NEXT_TASK)
    .select('id')

  if (claimErr) {
    return { ok: false, feeAmount: 0, legalManagerBonus: 0, error: claimErr.message }
  }
  if (!claimed?.length) {
    return { ok: true, feeAmount: 0, legalManagerBonus: 0, alreadyFinalized: true }
  }

  const revertClaim = async () => {
    await supabase
      .from('tasks')
      .update({ fee_status: FEE_STATUS_AWAITING_NEXT_TASK } as any)
      .eq('id', taskId)
      .eq('fee_status', FEE_STATUS_PAYABLE)
  }

  let assigneeRole: string | null = null
  if (task.assigned_to) {
    const { data: assignee } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', task.assigned_to)
      .maybeSingle()
    assigneeRole = assignee?.role ?? null
  }

  // مندوب: أتعاب معلقة فقط — لا صرفيات محامٍ ولا مكافأة مسؤول قانونية
  if (assigneeRole === 'delegate') {
    const { creditDelegateAddressFeePending } = await import('@/lib/delegate-wallet')
    const delegateFee = await creditDelegateAddressFeePending(supabase, taskId, reviewerId)
    if (!delegateFee.ok) {
      await revertClaim()
      return { ok: false, feeAmount: 0, legalManagerBonus: 0, error: delegateFee.error ?? 'فشل تسجيل أتعاب المندوب' }
    }
    // نسبة مسؤول القانونية إضافية ولا تُستقطع من أتعاب المندوب.
    const { creditLegalManagerBonusOnApproval } = await import('@/lib/legal-manager-wallet')
    const lmResult = await creditLegalManagerBonusOnApproval(supabase, taskId, reviewerId)
    if (!lmResult.ok) {
      await revertClaim()
      return {
        ok: false,
        feeAmount: delegateFee.amount,
        legalManagerBonus: 0,
        error: lmResult.error ?? 'فشل تسجيل نسبة مسؤول القانونية',
      }
    }
    return { ok: true, feeAmount: delegateFee.amount, legalManagerBonus: lmResult.amount }
  }

  const { approveTaskExpensesToWallet, reverseTaskExpenseDeductionOnFailure } = await import('@/lib/expense-wallet')
  const expenseResult = await approveTaskExpensesToWallet(supabase, taskId, reviewerId)
  if (!expenseResult.ok) {
    await revertClaim()
    return { ok: false, feeAmount: 0, legalManagerBonus: 0, error: expenseResult.error ?? 'فشل خصم صرفيات المهمة' }
  }

  const feeResult = await creditTaskFeeOnApproval(supabase, taskId, reviewerId)
  if (!feeResult.ok) {
    await reverseTaskExpenseDeductionOnFailure(supabase, taskId, reviewerId)
    await revertClaim()
    return { ok: false, feeAmount: 0, legalManagerBonus: 0, error: feeResult.error ?? 'فشل احتساب أتعاب المحامي' }
  }

  const { creditLegalManagerBonusOnApproval } = await import('@/lib/legal-manager-wallet')
  const lmResult = await creditLegalManagerBonusOnApproval(supabase, taskId, reviewerId)
  if (!lmResult.ok) {
    console.error('[finalizeTaskApproval] legal manager bonus failed:', lmResult.error)
    return { ok: true, feeAmount: feeResult.amount, legalManagerBonus: 0 }
  }
  if (lmResult.skipped && lmResult.reason) {
    console.warn('[finalizeTaskApproval]', lmResult.reason, 'task', taskId)
  }

  return { ok: true, feeAmount: feeResult.amount, legalManagerBonus: lmResult.amount }
}

/** Fees are credited on approval — no release when assigning the next task. */
export async function releasePreviousTaskFeeOnAssignment(
  _supabase: SupabaseClient,
  _debtorId: string,
  _assigningTaskId: string,
  _releasedBy: string,
): Promise<{ ok: boolean; amount: number; error?: string }> {
  return { ok: true, amount: 0 }
}

/** Fees are credited on approval — no release when bulk-assigning. */
export async function releasePreviousTaskFeesOnAssignment(
  _supabase: SupabaseClient,
  _assignedTaskIds: string[],
  _releasedBy: string,
): Promise<{ ok: boolean; error: string | null }> {
  return { ok: true, error: null }
}

/** @deprecated Use creditTaskFeeOnApproval */
export async function releaseTaskFees(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
) {
  await creditTaskFeeOnApproval(supabase, taskId, reviewerId)
}
