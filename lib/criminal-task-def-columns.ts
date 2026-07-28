/**
 * أعمدة criminal_case_task_definitions حسب الدور.
 * actual_fee_amount للمدير فقط — لا تُرجع عبر SELECT * لغير المدير.
 */

export const CRIMINAL_TASK_DEF_PUBLIC_COLUMNS =
  'id, label, fee_amount, sort_order, is_active, branch_id, created_at'

export const CRIMINAL_TASK_DEF_ADMIN_COLUMNS =
  `${CRIMINAL_TASK_DEF_PUBLIC_COLUMNS}, actual_fee_amount`

export function criminalTaskDefColumns(isAdminUser: boolean): string {
  return isAdminUser ? CRIMINAL_TASK_DEF_ADMIN_COLUMNS : CRIMINAL_TASK_DEF_PUBLIC_COLUMNS
}

export function stripActualFeeAmount<T extends Record<string, unknown>>(row: T): Omit<T, 'actual_fee_amount'> {
  const { actual_fee_amount: _hidden, ...rest } = row
  return rest
}
