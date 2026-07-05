import type { SupabaseClient } from '@supabase/supabase-js'

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

/** عند اعتماد صرفية: المطلوب والمتبقي يزيدان — يُفضَّل trigger DB */
export async function applyDebtorApprovedExpenseDelta(
  supabase: SupabaseClient,
  debtorId: string,
  expenseDelta: number,
): Promise<{ ok: boolean; error?: string }> {
  if (expenseDelta === 0) return { ok: true }

  const { data: debtor, error: readErr } = await supabase
    .from('debtors')
    .select('required_amount, total_payments')
    .eq('id', debtorId)
    .single()

  if (readErr || !debtor) {
    return { ok: false, error: readErr?.message ?? 'المدين غير موجود' }
  }

  const required_amount = Math.max(0, Number(debtor.required_amount ?? 0) + expenseDelta)
  const remaining_amount = computeRemainingFromRequired(
    required_amount,
    Number(debtor.total_payments ?? 0),
  )

  const { error } = await supabase
    .from('debtors')
    .update({ required_amount, remaining_amount })
    .eq('id', debtorId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
