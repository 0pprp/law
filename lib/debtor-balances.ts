import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * المبلغ المطلوب = المتبقي من الوصل + الشرط الجزائي.
 * إن وُجد مبلغ وصل > 0: لا يتجاوز مبلغ الوصل.
 * لا يشمل الصرفيات — تُسجَّل في total_expenses فقط.
 */
export function computeDebtorRequiredAmount(
  receiptRemaining: number,
  penaltyAmount: number,
  receiptAmount: number,
): number {
  const sum = Math.max(0, receiptRemaining) + Math.max(0, penaltyAmount)
  if (receiptAmount > 0) return Math.min(sum, receiptAmount)
  return sum
}

/** المتبقي = المبلغ المطلوب − إجمالي التسديدات */
export function computeRemainingFromRequired(
  requiredAmount: number,
  totalPayments: number,
): number {
  return Math.max(0, requiredAmount - totalPayments)
}

/** بعد تسديد أو حذف تسديد: المطلوب ثابت — المتبقي = المطلوب − مجموع التسديدات */
export async function syncDebtorRemainingAfterPayments(
  supabase: SupabaseClient,
  debtorId: string,
): Promise<{ ok: boolean; error?: string }> {
  const [{ data: debtor, error: readErr }, { data: paymentRows }] = await Promise.all([
    supabase.from('debtors').select('required_amount').eq('id', debtorId).single(),
    supabase.from('debtor_payments').select('amount').eq('debtor_id', debtorId),
  ])

  if (readErr || !debtor) {
    return { ok: false, error: readErr?.message ?? 'المدين غير موجود' }
  }

  const required = Number(debtor.required_amount ?? 0)
  const totalPayments = (paymentRows ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0)
  const remaining_amount = computeRemainingFromRequired(required, totalPayments)

  const { error } = await supabase
    .from('debtors')
    .update({ remaining_amount, total_payments: totalPayments })
    .eq('id', debtorId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** @deprecated الصرفيات لا تزيد المطلوب — يُزامَن total_expenses عبر trigger DB فقط */
export async function applyDebtorApprovedExpenseDelta(
  _supabase: SupabaseClient,
  _debtorId: string,
  _expenseDelta: number,
): Promise<{ ok: boolean; error?: string }> {
  return { ok: true }
}
