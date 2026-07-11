/**
 * قواعد رقم الوصل:
 * - فارغ غير مقبول
 * - الصفر (0 / 00 / 000…) يُسمح بتكراره
 * - أي رقم غير الصفر يجب أن يكون فريداً داخل نفس الفرع
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export function normalizeReceiptNumberInput(value: string | null | undefined): string {
  return String(value ?? '').trim()
}

/** صفر فقط — مثل 0 أو 00 أو 000 */
export function isZeroReceiptNumber(value: string | null | undefined): boolean {
  const t = normalizeReceiptNumberInput(value)
  return t.length > 0 && /^0+$/.test(t)
}

export function isReceiptNumberMissing(value: string | null | undefined): boolean {
  return normalizeReceiptNumberInput(value) === ''
}

/** يجب فرض التفرد على هذا الرقم (غير فارغ وغير صفر) */
export function requiresUniqueReceiptNumber(value: string | null | undefined): boolean {
  const t = normalizeReceiptNumberInput(value)
  return t.length > 0 && !isZeroReceiptNumber(t)
}

export const RECEIPT_NUMBER_EMPTY_ERROR = 'رقم الوصل فارغ'
export const RECEIPT_NUMBER_DUP_FILE_ERROR = 'رقم الوصل مكرر داخل الملف'
export const RECEIPT_NUMBER_DUP_BRANCH_ERROR = 'رقم الوصل موجود سابقاً داخل نفس الفرع'

/** يتحقق من تفرد رقم الوصل داخل الفرع (يتخطى الصفر). */
export async function findDuplicateReceiptInBranch(
  supabase: SupabaseClient,
  branchId: string,
  receiptNumber: string,
  excludeDebtorId?: string | null,
): Promise<{ duplicate: boolean; error?: string }> {
  const rn = normalizeReceiptNumberInput(receiptNumber)
  if (!rn || isZeroReceiptNumber(rn)) return { duplicate: false }

  let q = supabase
    .from('debtors')
    .select('id')
    .eq('branch_id', branchId)
    .eq('receipt_number', rn)

  if (excludeDebtorId) q = q.neq('id', excludeDebtorId)

  const { data, error } = await q.limit(1)
  if (error) return { duplicate: false, error: error.message }
  return { duplicate: (data?.length ?? 0) > 0 }
}
