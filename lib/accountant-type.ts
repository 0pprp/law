export type AccountantType = 'branch' | 'general'

export const ACCOUNTANT_TYPE_LABELS: Record<AccountantType, string> = {
  branch: 'محاسب فرع',
  general: 'محاسب عام',
}

export const ACCOUNTANT_TYPE_OPTIONS = (
  Object.entries(ACCOUNTANT_TYPE_LABELS) as [AccountantType, string][]
).map(([value, label]) => ({ value, label }))

export function isGeneralAccountantType(accountantType: string | null | undefined): boolean {
  return accountantType === 'general'
}

export function normalizeAccountantType(value: string | null | undefined): AccountantType {
  return value === 'general' ? 'general' : 'branch'
}
