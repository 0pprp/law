/**
 * أتعاب المهام الظاهرة حسب الدور ونوع الدعوى.
 * المدني: بدون تغيير.
 * الجزائي: المدير يرى القيمة الحقيقية؛ الباقون يحسبون/يعرضون صفراً.
 * لا تُعدَّل قيم قاعدة البيانات هنا — طبقة عرض/حساب فقط.
 * محفظة الصرفيات (savings) خارج نطاق هذه الوحدة تماماً.
 */
import { isAdmin } from '@/lib/permissions'
import { normalizeCaseType, type CaseType } from '@/lib/case-type'

export function canSeeCriminalTaskFees(role: string | null | undefined): boolean {
  return isAdmin(role)
}

export function isCriminalCaseType(caseType: string | null | undefined): boolean {
  return normalizeCaseType(caseType) === 'criminal'
}

/** قيمة أتعاب ظاهرة/محسوبة — لا تكتب إلى DB */
export function visibleTaskFeeAmount(
  amount: number | null | undefined,
  caseType: string | null | undefined,
  role: string | null | undefined,
): number {
  const n = Number(amount ?? 0)
  const safe = Number.isFinite(n) ? n : 0
  if (isCriminalCaseType(caseType) && !canSeeCriminalTaskFees(role)) return 0
  return safe
}

/** اختصار عندما يكون نوع الدعوى معروفاً مسبقاً كـ CaseType */
export function visibleTaskFeeForCase(
  amount: number | null | undefined,
  caseType: CaseType | null | undefined,
  role: string | null | undefined,
): number {
  return visibleTaskFeeAmount(amount, caseType, role)
}

/**
 * هل تُحتسب حركة محفظة أتعاب مرتبطة بمهمة جزائية للمشاهد؟
 * الصرفيات لا تمر من هنا.
 */
export function shouldCountFeesWalletTxForViewer(
  role: string | null | undefined,
  tx: { type?: string | null; reference_id?: string | null },
  criminalTaskIds: Set<string>,
): boolean {
  if (canSeeCriminalTaskFees(role)) return true
  if (tx.type !== 'approved_task_payment') return true
  const ref = typeof tx.reference_id === 'string' ? tx.reference_id.trim() : ''
  if (!ref) return true
  return !criminalTaskIds.has(ref)
}
