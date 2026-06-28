import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchLawyerSavingsBalance, insertWalletTransaction } from '@/lib/lawyer-wallet'

export interface TaskExpenseRow {
  id: string
  task_id: string | null
  amount: number
  expense_type: string | null
  description: string | null
  status: string | null
  created_by: string | null
  max_allowed_amount?: number | null
  wallet_deducted_at?: string | null
}

const PENDING_STATUSES = ['pending_review', 'pending_approval', 'pending']

async function resolveTaskLawyerId(
  supabase: SupabaseClient,
  taskId: string,
): Promise<string | null> {
  const { data: task } = await supabase
    .from('tasks')
    .select('assigned_to')
    .eq('id', taskId)
    .maybeSingle()
  return (task?.assigned_to as string | null) ?? null
}

/** Sum pending task expenses not yet deducted from wallet. */
export async function sumPendingTaskExpenses(
  supabase: SupabaseClient,
  taskId: string,
): Promise<number> {
  const { data } = await supabase
    .from('expenses')
    .select('amount')
    .eq('task_id', taskId)
    .in('status', PENDING_STATUSES)
    .is('wallet_deducted_at', null)

  return (data ?? []).reduce((s, e) => s + Number(e.amount ?? 0), 0)
}

/** Check lawyer disbursement wallet can cover pending task expenses. */
export async function checkDisbursementBalanceForTask(
  supabase: SupabaseClient,
  taskId: string,
): Promise<{ ok: boolean; required: number; available: number; lawyerId: string | null; error?: string }> {
  const lawyerId = await resolveTaskLawyerId(supabase, taskId)
  if (!lawyerId) {
    return { ok: false, required: 0, available: 0, lawyerId: null, error: 'لا يمكن تحديد المحامي' }
  }

  const required = await sumPendingTaskExpenses(supabase, taskId)
  if (required <= 0) {
    return { ok: true, required: 0, available: await fetchLawyerSavingsBalance(supabase, lawyerId), lawyerId }
  }

  const available = await fetchLawyerSavingsBalance(supabase, lawyerId)
  if (available < required) {
    return {
      ok: false,
      required,
      available,
      lawyerId,
      error: 'رصيد محفظة الصرفيات للمحامي غير كافٍ لاعتماد هذه الصرفية',
    }
  }
  return { ok: true, required, available, lawyerId }
}

async function deductSingleExpense(
  supabase: SupabaseClient,
  expense: TaskExpenseRow,
  lawyerId: string,
  approvedBy: string,
): Promise<{ ok: boolean; amount: number; error?: string; skipped?: boolean }> {
  if (expense.wallet_deducted_at) {
    return { ok: true, amount: 0, skipped: true }
  }

  const { data: existingTx } = await supabase
    .from('lawyer_wallet_transactions')
    .select('id')
    .eq('reference_id', expense.id)
    .eq('wallet', 'savings')
    .maybeSingle()

  if (existingTx) {
    await supabase
      .from('expenses')
      .update({ wallet_deducted_at: new Date().toISOString(), status: 'approved' })
      .eq('id', expense.id)
    return { ok: true, amount: 0, skipped: true }
  }

  const amount = Number(expense.amount ?? 0)
  if (amount <= 0) {
    await supabase.from('expenses').update({ status: 'approved' }).eq('id', expense.id)
    return { ok: true, amount: 0, skipped: true }
  }

  const label = expense.expense_type ?? 'صرفية'
  const note = expense.description?.trim()
    ? `${label} — ${expense.description.trim()}`
    : label

  const row = {
    lawyer_id: lawyerId,
    wallet: 'savings' as const,
    amount: -amount,
    notes: note,
    reference_id: expense.id,
    created_by: approvedBy,
  }

  let result = await insertWalletTransaction(supabase, { ...row, type: 'task_expense_deduction' })
  if (!result.ok && result.typeRejected) {
    result = await insertWalletTransaction(supabase, { ...row, type: 'accountant_transfer' })
  }
  if (!result.ok) {
    return { ok: false, amount: 0, error: result.error }
  }

  await supabase
    .from('expenses')
    .update({
      status: 'approved',
      wallet_deducted_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
    })
    .eq('id', expense.id)

  return { ok: true, amount }
}

/** On task approval: deduct all pending task expenses from lawyer disbursement wallet. */
export async function deductTaskExpensesOnApproval(
  supabase: SupabaseClient,
  taskId: string,
  approvedBy: string,
): Promise<{ ok: boolean; total: number; count: number; error?: string }> {
  const balanceCheck = await checkDisbursementBalanceForTask(supabase, taskId)
  if (!balanceCheck.ok) {
    return { ok: false, total: 0, count: 0, error: balanceCheck.error }
  }

  const { data: expenses } = await supabase
    .from('expenses')
    .select('id, task_id, amount, expense_type, description, status, created_by, max_allowed_amount, wallet_deducted_at')
    .eq('task_id', taskId)
    .in('status', PENDING_STATUSES)
    .is('wallet_deducted_at', null)

  const lawyerId = balanceCheck.lawyerId
  if (!lawyerId) {
    return { ok: false, total: 0, count: 0, error: 'لا يمكن تحديد المحامي' }
  }

  let total = 0
  let count = 0
  for (const exp of (expenses ?? []) as TaskExpenseRow[]) {
    const result = await deductSingleExpense(supabase, exp, lawyerId, approvedBy)
    if (!result.ok && !result.skipped) {
      return { ok: false, total, count, error: result.error }
    }
    if (result.ok && result.amount > 0) {
      total += result.amount
      count += 1
    }
  }
  return { ok: true, total, count }
}

/** On task rejection: mark linked expenses rejected. */
export async function rejectTaskExpenses(
  supabase: SupabaseClient,
  taskId: string,
): Promise<void> {
  await supabase
    .from('expenses')
    .update({ status: 'rejected' })
    .eq('task_id', taskId)
    .in('status', PENDING_STATUSES)
    .is('wallet_deducted_at', null)
}

export async function fetchTaskExpensesForReview(
  supabase: SupabaseClient,
  taskId: string,
): Promise<TaskExpenseRow[]> {
  const { data } = await supabase
    .from('expenses')
    .select('id, task_id, amount, expense_type, description, status, created_by, max_allowed_amount, wallet_deducted_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
  return (data ?? []) as TaskExpenseRow[]
}

/** @deprecated Use deductTaskExpensesOnApproval — kept for import compatibility */
export const approveTaskExpensesToWallet = deductTaskExpensesOnApproval
