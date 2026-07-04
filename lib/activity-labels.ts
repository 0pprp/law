/** Arabic labels for activity log — never show raw English action/entity keys in UI */

export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  assign_task: 'تكليف مهمة',
  bulk_assign_tasks: 'تكليف مهام',
  create_task: 'إنشاء مهمة',
  update_task: 'تعديل مهمة',
  submit_task: 'تسليم إنجاز',
  complete_task: 'إنجاز مهمة',
  approve_task_transition: 'اعتماد إنجاز',
  approve_task: 'اعتماد إنجاز',
  reject_task: 'رفض إنجاز',
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
  update_lawyer_identity: 'تحديث بيانات محامي',
  upload_lawyer_file: 'رفع مستمسك محامي',
  delete_lawyer_file: 'حذف مستمسك محامي',
  deactivate_lawyer: 'تعطيل محامي',
  lawyer_wallet_credit: 'صرفيات محامي',
  lawyer_savings_withdraw: 'سحب صرفيات محامي',
  lawyer_fee_payout: 'صرف أتعاب محامي',
  submit_lawyer_payout_request: 'طلب صرف أتعاب',
  approve_lawyer_payout_request: 'اعتماد طلب صرف أتعاب',
  reject_lawyer_payout_request: 'رفض طلب صرف أتعاب',
  legal_manager_task_bonus: 'مكافأة مدير القانونية (اعتماد إنجاز)',
  approve_legal_manager_payout: 'اعتماد طلب سحب مدير القانونية',
  reject_legal_manager_payout: 'رفض طلب سحب مدير القانونية',
  legal_manager_manual_deposit: 'إيداع يدوي لمحفظة مدير القانونية',
  legal_manager_manual_withdrawal: 'سحب يدوي من محفظة مدير القانونية',
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
  legal_manager_task_bonus: 'success',
  approve_legal_manager_payout: 'success',
  reject_legal_manager_payout: 'danger',
  legal_manager_manual_deposit: 'success',
  legal_manager_manual_withdrawal: 'warning',
  approve_expense: 'success',
  add_payment: 'success',
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
  close_case: 'navy',
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

export function fmtActivityDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ar-IQ', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    numberingSystem: 'latn',
  })
}
