import { REQUIRED_FIELD_LABELS, type RequiredField } from '@/lib/types'

export interface CompletionRequiredField {
  field_key: string
  field_type: string
  field_label: string | null
  is_required: boolean
}

/** يتحقق فقط من الحقول المعلّمة is_required؛ الحقول الاختيارية لا تمنع الإرسال. */
export function validateTaskCompletionFields(
  fields: CompletionRequiredField[],
  values: Record<string, string>,
  fileKeys: ReadonlySet<string>,
): string | null {
  for (const field of fields) {
    if (!field.is_required) continue
    const label = field.field_label
      ?? REQUIRED_FIELD_LABELS[field.field_type as RequiredField]
      ?? field.field_type

    if (['image', 'pdf', 'receipt'].includes(field.field_type)) {
      if (!fileKeys.has(field.field_key)) return `يجب رفع: ${label}`
    } else if (field.field_type === 'gps') {
      if (!values[field.field_key]) return 'يجب تحديد موقع GPS'
    } else if (!values[field.field_key]?.trim()) {
      return `يجب إدخال: ${label}`
    }
  }
  return null
}
