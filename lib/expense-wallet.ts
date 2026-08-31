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
  knownLawyerId?: string | null,
): Promise<{ ok: boolean; required: number; available: number; lawyerId: string | null; error?: string }> {
  const lawyerId = knownLawyerId ?? await resolveTaskLawyerId(supabase, taskId)
  if (!lawyerId) {
    return { ok: false, required: 0, available: 0, lawyerId: null, error: 'لا يمكن تحديد المحامي' }
  }

  const required = await sumPendingTaskExpenses(supabase, taskId)
  if (required <= 0) {
    return { ok: true, required: 0, available: 0, lawyerId }
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
    .select('id, type')
    .eq('reference_id', taskId)
    .eq('wallet', 'savings')
    .in('type', [DEDUCTION_TX_TYPE, 'task_expense_deduction'])
    .lt('amount', 0)
    .limit(1)
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
  _supabase: SupabaseClient,
  taskId: string,
  expenses: TaskExpenseRow[],
  total: number,
  _approvedBy: string,
): Promise<string> {
  const lines = expenses
    .filter(e => Number(e.amount) > 0)
    .map(e => {
      const label = e.expense_type ?? 'صرفية'
      const note = e.description?.trim()
      return note ? `${label}: ${Number(e.amount).toLocaleString('en-US')} د.ع (${note})` : `${label}: ${Number(e.amount).toLocaleString('en-US')} د.ع`
    })

  return [
    'خصم صرفيات معتمدة عند اعتماد إنجاز مهمة',
    `مرجع المهمة: ${taskId}`,
    ...lines,
    `الإجمالي: ${total.toLocaleString('en-US')} د.ع`,
  ].join('\n')
}

/** On task approval: one consolidated deduction per task from lawyer disbursement wallet. */
export async function deductTaskExpensesOnApproval(
  supabase: SupabaseClient,
  taskId: string,
  approvedBy: string,
  opts?: { lawyerId?: string | null },
): Promise<{ ok: boolean; total: number; count: number; error?: string; skipped?: boolean }> {
  const existingTxPromise = findTaskDeductionTransaction(supabase, taskId)
  const expensesPromise = supabase
    .from('expenses')
    .select('id, task_id, amount, expense_type, description, status, created_by, max_allowed_amount, wallet_deducted_at')
    .eq('task_id', taskId)
    .in('status', PENDING_STATUSES)
    .is('wallet_deducted_at', null)

  const [existingTx, expensesRes] = await Promise.all([existingTxPromise, expensesPromise])
  const rows = (expensesRes.data ?? []) as TaskExpenseRow[]

  if (existingTx) {
    await markExpensesApproved(supabase, rows.map(e => e.id), approvedBy)
    return { ok: true, total: 0, count: 0, skipped: true }
  }

  const payable = rows.filter(e => Number(e.amount) > 0)
  if (!payable.length) {
    await markExpensesApproved(supabase, rows.map(e => e.id), approvedBy)
    return { ok: true, total: 0, count: 0 }
  }

  const total = payable.reduce((s, e) => s + Number(e.amount), 0)
  const balanceCheck = await checkDisbursementBalanceForTask(supabase, taskId, opts?.lawyerId)
  if (!balanceCheck.ok) {
    return { ok: false, total: 0, count: 0, error: balanceCheck.error }
  }

  const lawyerId = balanceCheck.lawyerId
  if (!lawyerId) {
    return { ok: false, total: 0, count: 0, error: 'لا يمكن تحديد المحامي' }
  }

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

/**
 * تعويض عند فشل إضافة الأتعاب بعد خصم الصرفيات — يعيد الرصيد دون تغيير المعادلات.
 * Idempotent: إن لم توجد حركة خصم لا يفعل شيئاً.
 */
export async function reverseTaskExpenseDeductionOnFailure(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const existingTx = await findTaskDeductionTransaction(supabase, taskId)

  // أعد حالة الصرفيات المرتبطة بالمهمة إلى بانتظار الاعتماد
  await supabase
    .from('expenses')
    .update({
      status: 'pending_review',
      wallet_deducted_at: null,
      approved_at: null,
      approved_by: null,
    } as any)
    .eq('task_id', taskId)
    .eq('status', 'approved')

  if (!existingTx) return { ok: true }

  const { data: tx } = await supabase
    .from('lawyer_wallet_transactions')
    .select('id, lawyer_id, amount, wallet')
    .eq('id', existingTx.id)
    .maybeSingle()

  if (!tx) return { ok: true }

  // حذف حركة الخصم الأصلية للحفاظ على idempotency عند إعادة الاعتماد
  const { error: delErr } = await supabase
    .from('lawyer_wallet_transactions')
    .delete()
    .eq('id', tx.id)

  if (delErr) {
    // إن فشل الحذف: أضف حركة عكسية صريحة
    const reverseAmount = -Number(tx.amount ?? 0)
    if (reverseAmount !== 0) {
      const { insertWalletTransaction } = await import('@/lib/lawyer-wallet')
      const reverse = await insertWalletTransaction(supabase, {
        lawyer_id: tx.lawyer_id,
        wallet: (tx.wallet as 'savings' | 'fees') || 'savings',
        amount: reverseAmount,
        type: 'manual_adjustment',
        notes: `عكس خصم صرفيات بسبب فشل اعتماد الأتعاب — مهمة ${taskId}`,
        reference_id: crypto.randomUUID(),
        created_by: reviewerId,
      })
      if (!reverse.ok) {
        return { ok: false, error: reverse.error ?? 'فشل عكس خصم الصرفيات' }
      }
    }
  }

  return { ok: true }
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

/**
 * خصم صرفية يدوية على مدين من محفظة صرفيات المحامي المختار.
 * يُستدعى بعد إدراج سجل المصروف — reference_id = معرف الصرفية.
 */
export async function deductLawyerWalletForDebtorExpense(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    amount: number
    expenseId: string
    actorId: string
    debtorName: string
    note: string
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { lawyerId, amount, expenseId, actorId, debtorName, note } = params
  const available = await fetchLawyerSavingsBalance(supabase, lawyerId)
  if (amount > available) {
    return {
      ok: false,
      error: `رصيد محفظة الصرفيات غير كافٍ — المتاح: ${Number(available).toLocaleString('en-US')} د.ع`,
    }
  }

  const notes = [
    `صرفية مدين: ${debtorName}`,
    note.trim() ? note.trim() : null,
  ].filter(Boolean).join(' — ')

  const row = {
    lawyer_id: lawyerId,
    wallet: 'savings' as const,
    amount: -amount,
    notes,
    reference_id: expenseId,
    created_by: actorId,
  }

  let result = await insertWalletTransaction(supabase, {
    ...row,
    type: DEDUCTION_TX_TYPE,
  })
  if (!result.ok && result.typeRejected) {
    result = await insertWalletTransaction(supabase, {
      ...row,
      type: 'task_expense_deduction',
    })
  }
  if (!result.ok) return { ok: false, error: result.error }

  const now = new Date().toISOString()
  await supabase
    .from('expenses')
    .update({ wallet_deducted_at: now } as any)
    .eq('id', expenseId)

  return { ok: true }
}

/** @deprecated Use deductTaskExpensesOnApproval — kept for import compatibility */
export const approveTaskExpensesToWallet = deductTaskExpensesOnApproval
