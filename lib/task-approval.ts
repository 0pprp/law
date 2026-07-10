import type { SupabaseClient } from '@supabase/supabase-js'
import { taskLawyerId } from '@/lib/task-assignment'

function unwrapTaskDef(raw: unknown): { fee_amount?: number; label?: string } | null {
  if (!raw) return null
  if (Array.isArray(raw)) return (raw[0] as { fee_amount?: number; label?: string }) ?? null
  return raw as { fee_amount?: number; label?: string }
}

const APPROVED_STATUSES = new Set(['approved', 'completed'])
const FEE_TX_TYPES = ['approved_task_payment', 'manual_adjustment', 'task_fee'] as const

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
  const { error } = await supabase.from('tasks').update({ fee_status: 'released' } as any).eq('id', taskId)
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
  const amount = await resolveTaskFeeAmount(supabase, task)
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
 * Approve task completion: status → approved, deduct expenses, credit lawyer fees immediately.
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

  const alreadyApproved = APPROVED_STATUSES.has(task.task_status)

  let assigneeRole: string | null = null
  if (task.assigned_to) {
    const { data: assignee } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', task.assigned_to)
      .maybeSingle()
    assigneeRole = assignee?.role ?? null
  }

  // مندوب: اعتماد بدون صرفيات محامي، وأتعاب معلقة فقط
  if (assigneeRole === 'delegate') {
    if (!alreadyApproved) {
      const { error: approveErr } = await supabase
        .from('tasks')
        .update({
          task_status: 'approved',
          completed_at: task.completed_at ?? new Date().toISOString(),
        } as any)
        .eq('id', taskId)
      if (approveErr) {
        return { ok: false, feeAmount: 0, error: approveErr.message }
      }
    }
    const { creditDelegateAddressFeePending } = await import('@/lib/delegate-wallet')
    const delegateFee = await creditDelegateAddressFeePending(supabase, taskId, reviewerId)
    if (!delegateFee.ok) {
      if (!alreadyApproved) {
        await supabase.from('tasks').update({ task_status: 'submitted' } as any).eq('id', taskId)
      }
      return { ok: false, feeAmount: 0, error: delegateFee.error ?? 'فشل تسجيل أتعاب المندوب' }
    }
    return { ok: true, feeAmount: delegateFee.amount, legalManagerBonus: 0 }
  }

  if (!alreadyApproved) {
    const { checkDisbursementBalanceForTask, approveTaskExpensesToWallet } = await import('@/lib/expense-wallet')
    const balanceCheck = await checkDisbursementBalanceForTask(supabase, taskId)
    if (!balanceCheck.ok && balanceCheck.required > 0) {
      return { ok: false, feeAmount: 0, error: balanceCheck.error ?? 'رصيد محفظة الصرفيات للمحامي غير كافٍ' }
    }

    const { error: approveErr } = await supabase
      .from('tasks')
      .update({
        task_status: 'approved',
        completed_at: task.completed_at ?? new Date().toISOString(),
      } as any)
      .eq('id', taskId)

    if (approveErr) {
      return { ok: false, feeAmount: 0, error: approveErr.message }
    }

    const expenseResult = await approveTaskExpensesToWallet(supabase, taskId, reviewerId)
    if (!expenseResult.ok) {
      await supabase.from('tasks').update({ task_status: 'submitted' } as any).eq('id', taskId)
      return { ok: false, feeAmount: 0, error: expenseResult.error ?? 'فشل خصم صرفيات المهمة' }
    }
  }

  const feeResult = await creditTaskFeeOnApproval(supabase, taskId, reviewerId)
  if (!feeResult.ok) {
    if (!alreadyApproved) {
      const { reverseTaskExpenseDeductionOnFailure } = await import('@/lib/expense-wallet')
      await reverseTaskExpenseDeductionOnFailure(supabase, taskId, reviewerId)
      await supabase.from('tasks').update({ task_status: 'submitted' } as any).eq('id', taskId)
    }
    return { ok: false, feeAmount: 0, error: feeResult.error ?? 'فشل احتساب أتعاب المحامي' }
  }

  const { creditLegalManagerBonusOnApproval } = await import('@/lib/legal-manager-wallet')
  const lmResult = await creditLegalManagerBonusOnApproval(supabase, taskId, reviewerId)
  if (!lmResult.ok) {
    console.error('[approveTaskCompletion] legal manager bonus failed:', lmResult.error)
    // الاعتماد وأتعاب المحامي تمّا — لا نمنع نافذة المهمة التالية
    return { ok: true, feeAmount: feeResult.amount, legalManagerBonus: 0 }
  }
  if (lmResult.skipped && lmResult.reason) {
    console.warn('[approveTaskCompletion]', lmResult.reason, 'task', taskId)
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
