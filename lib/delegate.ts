/** ثابت أتعاب مندوب مهمة إيجاد عنوان */
export const DELEGATE_ADDRESS_FEE = 10_000

export type DebtorNotifiedStatus = 'unset' | 'yes' | 'no'

export const DEBTOR_NOTIFIED_LABELS: Record<DebtorNotifiedStatus, string> = {
  unset: 'لم يحدد',
  yes: 'نعم',
  no: 'لا',
}

export const DEBTOR_NOTIFIED_OPTIONS = (
  Object.entries(DEBTOR_NOTIFIED_LABELS) as [DebtorNotifiedStatus, string][]
).map(([value, label]) => ({ value, label }))

export type DelegateFeeStatus = 'none' | 'pending' | 'available' | 'withdrawn'

export const DELEGATE_FEE_STATUS_LABELS: Record<DelegateFeeStatus, string> = {
  none: '—',
  pending: 'معلقة',
  available: 'قابلة للصرف',
  withdrawn: 'مصروفة',
}

/** هل تعريف المهمة من نوع إيجاد عنوان (أو إيجاد عنوان المفقود) */
export function isFindAddressTaskType(taskType: string | null | undefined): boolean {
  return taskType === 'find_address' || taskType === 'find_missing_address'
}

export function normalizeDebtorNotified(value: string | null | undefined): DebtorNotifiedStatus {
  if (value === 'yes' || value === 'no') return value
  return 'unset'
}

export function normalizeDelegateFeeStatus(value: string | null | undefined): DelegateFeeStatus {
  if (value === 'pending' || value === 'available' || value === 'withdrawn') return value
  return 'none'
}
