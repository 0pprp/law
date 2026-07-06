export type LawyerType = 'normal' | 'general'

export const LAWYER_TYPE_LABELS: Record<LawyerType, string> = {
  normal: 'محامي عادي',
  general: 'محامي عام',
}

export const LAWYER_TYPE_OPTIONS = (Object.entries(LAWYER_TYPE_LABELS) as [LawyerType, string][]).map(
  ([value, label]) => ({ value, label }),
)

export function isGeneralLawyerType(lawyerType: string | null | undefined): boolean {
  return lawyerType === 'general'
}

export function normalizeLawyerType(value: string | null | undefined): LawyerType {
  return value === 'general' ? 'general' : 'normal'
}
