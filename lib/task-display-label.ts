import { TASK_TYPE_LABELS, REQUIRED_FIELD_LABELS, type TaskType, type RequiredField } from '@/lib/types'

/** Canonical task name: definition label from settings, then legacy task_type label. */
export function resolveTaskLabel(
  taskType: string,
  definitionLabel?: string | null,
): string {
  if (definitionLabel?.trim()) return definitionLabel.trim()
  return TASK_TYPE_LABELS[taskType as TaskType] ?? taskType
}

export function formatRequiredFieldLabel(field: {
  field_label?: string | null
  field_type: string
}): string {
  return (
    field.field_label?.trim()
    ?? REQUIRED_FIELD_LABELS[field.field_type as RequiredField]
    ?? field.field_type
  )
}

export interface TaskRequiredFieldDisplay {
  label: string
  isRequired: boolean
  fieldType: string
}
