/** نوع الدعوى على المدين وتعريفات المهام — مدنية | جزائية */

export type CaseType = 'civil' | 'criminal'

export const CASE_TYPE_CIVIL: CaseType = 'civil'
export const CASE_TYPE_CRIMINAL: CaseType = 'criminal'

export const CASE_TYPE_LABELS: Record<CaseType, string> = {
  civil: 'دعوى مدنية',
  criminal: 'دعوى جزائية',
}

export const CASE_TYPE_OPTIONS: { value: CaseType; label: string }[] = [
  { value: 'civil', label: CASE_TYPE_LABELS.civil },
  { value: 'criminal', label: CASE_TYPE_LABELS.criminal },
]

export const CASE_TYPE_FILTER_OPTIONS: { value: '' | CaseType; label: string }[] = [
  { value: '', label: 'كل أنواع الدعاوى' },
  ...CASE_TYPE_OPTIONS,
]

export function isCaseType(v: unknown): v is CaseType {
  return v === 'civil' || v === 'criminal'
}

export function normalizeCaseType(v: unknown): CaseType {
  return isCaseType(v) ? v : 'civil'
}

/** قيم التاسك تايب القديمة للجزائية (قبل عمود case_type) */
export const LEGACY_CRIMINAL_TASK_TYPES = [
  'criminal_lawsuit_request',
  'police_station_statement',
  'court_statement',
  'witness_statement',
] as const
