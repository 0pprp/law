import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchLawyerSavingsBalance, insertWalletTransaction } from '@/lib/lawyer-wallet'
import { resolveTaskLabel } from '@/lib/task-display-label'

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
const DEDUCTION_TX_TYPE = 'lawyer_expense_wallet_deduction'

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

async function findTaskDeductionTransaction(
  supabase: SupabaseClient,
  taskId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from('lawyer_wallet_transactions')
    .select('id')
    .eq('reference_id', taskId)
    .eq('wallet', 'savings')
    .eq('type', DEDUCTION_TX_TYPE)
    .maybeSingle()
  return data ?? null
}

async function markExpensesApproved(
  supabase: SupabaseClient,
  expenseIds: string[],
  approvedBy: string,
): Promise<void> {
  if (!expenseIds.length) return
  const now = new Date().toISOString()
  await supabase
    .from('expenses')
    .update({
      status: 'approved',
      wallet_deducted_at: now,
      approved_at: now,
      approved_by: approvedBy,
    })
    .in('id', expenseIds)
}

async function buildDeductionNotes(
  supabase: SupabaseClient,
  taskId: string,
  expenses: TaskExpenseRow[],
  total: number,
  approvedBy: string,
): Promise<string> {
  const { data: task } = await supabase
    .from('tasks')
    .select('task_type, debtor_id, task_definitions(label)')
    .eq('id', taskId)
    .maybeSingle()

  const defs = task?.task_definitions as { label?: string } | { label?: string }[] | null
  const defLabel = Array.isArray(defs) ? defs[0]?.label : defs?.label
  const taskLabel = resolveTaskLabel(task?.task_type ?? null, defLabel)

  let debtorName = '—'
  if (task?.debtor_id) {
    const { data: debtor } = await supabase
      .from('debtors')
      .select('full_name')
      .eq('id', task.debtor_id)
      .maybeSingle()
    debtorName = debtor?.full_name ?? '—'
  }

  const { data: approver } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', approvedBy)
    .maybeSingle()
  const approverName = approver?.full_name ?? '—'

  const lines = expenses
    .filter(e => Number(e.amount) > 0)
    .map(e => {
      const label = e.expense_type ?? 'صرفية'
      const note = e.description?.trim()
      return note ? `${label}: ${Number(e.amount).toLocaleString('en-US')} د.ع (${note})` : `${label}: ${Number(e.amount).toLocaleString('en-US')} د.ع`
    })

  return [
    'خصم صرفيات معتمدة عند اعتماد إنجاز مهمة',
    `المهمة: ${taskLabel}`,
    `المدين: ${debtorName}`,
    ...lines,
    `الإجمالي: ${total.toLocaleString('en-US')} د.ع`,
    `اعتمد: ${approverName}`,
  ].join('\n')
}

/** On task approval: one consolidated deduction per task from lawyer disbursement wallet. */
export async function deductTaskExpensesOnApproval(
  supabase: SupabaseClient,
  taskId: string,
  approvedBy: string,
): Promise<{ ok: boolean; total: number; count: number; error?: string; skipped?: boolean }> {
  const existingTx = await findTaskDeductionTransaction(supabase, taskId)
  if (existingTx) {
    const { data: pending } = await supabase
      .from('expenses')
      .select('id')
      .eq('task_id', taskId)
      .in('status', PENDING_STATUSES)
      .is('wallet_deducted_at', null)
    await markExpensesApproved(supabase, (pending ?? []).map(e => e.id), approvedBy)
    return { ok: true, total: 0, count: 0, skipped: true }
  }

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

  const rows = (expenses ?? []) as TaskExpenseRow[]
  const lawyerId = balanceCheck.lawyerId
  if (!lawyerId) {
    return { ok: false, total: 0, count: 0, error: 'لا يمكن تحديد المحامي' }
  }

  const payable = rows.filter(e => Number(e.amount) > 0)
  if (!payable.length) {
    await markExpensesApproved(supabase, rows.map(e => e.id), approvedBy)
    return { ok: true, total: 0, count: 0 }
  }

  const total = payable.reduce((s, e) => s + Number(e.amount), 0)
  const notes = await buildDeductionNotes(supabase, taskId, payable, total, approvedBy)

  const row = {
    lawyer_id: lawyerId,
    wallet: 'savings' as const,
    amount: -total,
    notes,
    reference_id: taskId,
    created_by: approvedBy,
  }

  let result = await insertWalletTransaction(supabase, { ...row, type: DEDUCTION_TX_TYPE })
  if (!result.ok && result.typeRejected) {
    result = await insertWalletTransaction(supabase, { ...row, type: 'task_expense_deduction' })
  }
  if (!result.ok) {
    return { ok: false, total: 0, count: 0, error: result.error }
  }

  await markExpensesApproved(supabase, rows.map(e => e.id), approvedBy)
  return { ok: true, total, count: payable.length }
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
