/** Arabic labels for activity log — never show raw English action/entity keys in UI */

export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  assign_task: 'تكليف مهمة',
  bulk_assign_tasks: 'تكليف مهام',
  create_task: 'إنشاء مهمة',
  update_task: 'تعديل مهمة',
  submit_task: 'تسليم إنجاز',
  submit_task_expenses: 'تسجيل صرفيات المهمة',
  complete_task: 'إنجاز مهمة',
  approve_task_transition: 'اعتماد إنجاز',
  approve_task: 'اعتماد إنجاز',
  reject_task: 'رفض إنجاز',
  move_to_payment_in_progress: 'تحويل إلى جاري التسديد',
  submit_payment_noncompliance_request: 'طلب عدم التزام',
  approve_payment_noncompliance_request: 'موافقة طلب عدم التزام',
  reject_payment_noncompliance_request: 'رفض طلب عدم التزام',
  delete_task: 'حذف مهمة',
  upload_task_file: 'رفع ملف مهمة',
  delete_task_file: 'حذف ملف مهمة',
  close_case: 'إقفال قضية',
  add_expense: 'إضافة صرفية',
  update_expense: 'تعديل صرفية',
  delete_expense: 'حذف صرفية',
  approve_expense: 'اعتماد صرفية',
  reject_expense: 'رفض صرفية',
  add_payment: 'تسجيل تسديد',
  update_payment: 'تعديل تسديد',
  delete_payment: 'حذف تسديد',
  create_debtor: 'إضافة مدين',
  update_debtor: 'تعديل مدين',
  delete_debtor: 'حذف مدين',
  update_debtor_gps: 'تحديث موقع مدين',
  upload_debtor_file: 'رفع ملف مدين',
  delete_debtor_file: 'حذف ملف مدين',
  create_lawyer: 'إضافة محامي',
  create_accountant: 'إضافة محاسب',
  create_viewer: 'إضافة مسؤول قانونية',
  create_employee: 'إضافة موظف',
  update_lawyer_identity: 'تحديث بيانات محامي',
  update_delegate: 'تعديل مندوب',
  upload_lawyer_file: 'رفع مستمسك محامي',
  delete_lawyer_file: 'حذف مستمسك محامي',
  deactivate_lawyer: 'تعطيل محامي',
  activate_lawyer: 'تفعيل محامي',
  delete_user: 'حذف مستخدم',
  delete_delegate: 'حذف مندوب',
  deactivate_delegate: 'تعطيل مندوب',
  activate_delegate: 'تفعيل مندوب',
  lawyer_wallet_credit: 'إيداع محفظة صرفيات محامي',
  lawyer_wallet_deposit: 'إيداع محفظة صرفيات محامي',
  lawyer_savings_withdraw: 'سحب صرفيات محامي',
  lawyer_fee_payout: 'صرف أتعاب محامي',
  submit_lawyer_payout_request: 'طلب صرف أتعاب',
  approve_lawyer_payout_request: 'اعتماد طلب صرف أتعاب',
  reject_lawyer_payout_request: 'رفض طلب صرف أتعاب',
  legal_manager_task_bonus: 'نسبة مسؤول القانونية (اعتماد إنجاز)',
  legal_manager_percentage_fee: 'نسبة 5% لمسؤول القانونية (اعتماد إنجاز)',
  approve_legal_manager_payout: 'اعتماد طلب سحب مسؤول القانونية',
  reject_legal_manager_payout: 'رفض طلب سحب مسؤول القانونية',
  legal_manager_manual_deposit: 'إيداع يدوي لمحفظة مسؤول القانونية',
  legal_manager_manual_withdrawal: 'سحب يدوي من محفظة مسؤول القانونية',
  login: 'تسجيل دخول',
}

export const ACTIVITY_ENTITY_LABELS: Record<string, string> = {
  task: 'مهمة',
  debtor: 'مدين',
  expense: 'صرفية',
  payment: 'تسديد',
  lawyer: 'محامي',
  file: 'ملف',
  profile: 'مستخدم',
  branch: 'فرع',
  case: 'قضية',
}

export const ACTIVITY_ACTION_BADGE: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'orange' | 'navy'> = {
  complete_task: 'success',
  approve_task_transition: 'success',
  approve_task: 'success',
  submit_task_expenses: 'info',
  legal_manager_task_bonus: 'success',
  legal_manager_percentage_fee: 'success',
  approve_legal_manager_payout: 'success',
  reject_legal_manager_payout: 'danger',
  legal_manager_manual_deposit: 'success',
  legal_manager_manual_withdrawal: 'warning',
  approve_expense: 'success',
  add_payment: 'success',
  create_debtor: 'success',
  create_lawyer: 'success',
  create_accountant: 'success',
  create_viewer: 'success',
  create_employee: 'success',
  lawyer_wallet_credit: 'success',
  lawyer_wallet_deposit: 'success',
  assign_task: 'info',
  bulk_assign_tasks: 'info',
  create_task: 'info',
  submit_task: 'info',
  update_task: 'warning',
  update_expense: 'warning',
  add_expense: 'warning',
  reject_task: 'danger',
  reject_expense: 'danger',
  delete_debtor: 'danger',
  delete_payment: 'danger',
  delete_task: 'danger',
  delete_expense: 'danger',
  deactivate_lawyer: 'danger',
  activate_lawyer: 'success',
  delete_user: 'danger',
  delete_delegate: 'danger',
  deactivate_delegate: 'danger',
  activate_delegate: 'success',
  close_case: 'navy',
  move_to_payment_in_progress: 'info',
  submit_payment_noncompliance_request: 'warning',
  approve_payment_noncompliance_request: 'success',
  reject_payment_noncompliance_request: 'danger',
}

export function activityActionLabel(action: string | null | undefined): string {
  if (!action) return '—'
  return ACTIVITY_ACTION_LABELS[action] ?? 'إجراء غير معرّف'
}

export function activityEntityLabel(entityType: string | null | undefined): string {
  if (!entityType) return '—'
  return ACTIVITY_ENTITY_LABELS[entityType] ?? 'كيان غير معرّف'
}

export function activityLogDescription(log: { new_data?: { description?: string } | null }): string {
  const desc = log.new_data?.description
  return desc?.trim() ? desc : '—'
}

function parseActivityInstant(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export function fmtActivityDate(iso: string | null | undefined): string {
  const date = parseActivityInstant(iso)
  if (!date) return '—'
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}/${m}/${d}`
}

export function fmtActivityTime(iso: string | null | undefined): string {
  const date = parseActivityInstant(iso)
  if (!date) return '—'
  const hours24 = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const period = hours24 < 12 ? 'ص' : 'م'
  let hours12 = hours24 % 12
  if (hours12 === 0) hours12 = 12
  return `${hours12}:${minutes} ${period}`
}

export function fmtActivityDateTime(iso: string | null | undefined): string {
  const date = fmtActivityDate(iso)
  const time = fmtActivityTime(iso)
  if (date === '—' && time === '—') return '—'
  return `${date} · ${time}`
}
