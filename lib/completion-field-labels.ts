import { REQUIRED_FIELD_LABELS, type RequiredField } from '@/lib/types'

/** Arabic labels for common completion field keys (legacy / auto keys). */
export const COMPLETION_KEY_LABELS: Record<string, string> = {
  court_name: 'اسم المحكمة',
  case_number: 'رقم الدعوى',
  hearing_date: 'تاريخ الجلسة',
  court_decision: 'قرار المحكمة',
  team: 'الفريق',
  decision_number: 'رقم القرار',
  legal_result: 'النتيجة القانونية',
  note: 'ملاحظة',
  date: 'التاريخ',
  gps: 'موقع GPS',
  receipt: 'وصل الصرف',
  image: 'صورة',
  pdf: 'ملف PDF',
  text: 'نص',
  number: 'رقم',
}

export function buildCompletionFieldLabelMap(
  fields: { field_key: string; field_label?: string | null; field_type?: string }[],
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const f of fields) {
    map[f.field_key] = resolveCompletionFieldLabel(f.field_key, null, f.field_label, f.field_type)
  }
  return map
}

export function resolveCompletionFieldLabel(
  key: string,
  fieldLabels?: Record<string, string> | null,
  explicitLabel?: string | null,
  fieldType?: string | null,
): string {
  if (fieldLabels?.[key]) return fieldLabels[key]
  if (explicitLabel?.trim()) return explicitLabel.trim()
  if (COMPLETION_KEY_LABELS[key]) return COMPLETION_KEY_LABELS[key]

  const indexed = key.match(/^field_\d+_(.+)$/)
  if (indexed) {
    const type = indexed[1] as RequiredField
    if (REQUIRED_FIELD_LABELS[type]) return REQUIRED_FIELD_LABELS[type]
    if (COMPLETION_KEY_LABELS[type]) return COMPLETION_KEY_LABELS[type]
  }

  if (fieldType && REQUIRED_FIELD_LABELS[fieldType as RequiredField]) {
    return REQUIRED_FIELD_LABELS[fieldType as RequiredField]
  }

  return COMPLETION_KEY_LABELS[key] ?? key.replace(/_/g, ' ')
}
