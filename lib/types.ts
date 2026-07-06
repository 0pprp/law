export type UserRole = 'admin' | 'employee' | 'accountant' | 'lawyer' | 'viewer'
export type LawyerType = 'normal' | 'general'
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'
export type ReceiptStatus = 'pending' | 'approved' | 'rejected'
export type WalletTransactionType = 'accountant_transfer' | 'approved_task_payment' | 'manual_adjustment' | 'fee_payout' | 'transfer_from_savings' | 'savings_withdrawal' | 'task_expense_deduction' | 'lawyer_expense_wallet_deduction' | 'legal_manager_task_bonus' | 'legal_manager_percentage_fee' | 'legal_manager_withdrawal' | 'legal_manager_manual_deposit' | 'legal_manager_manual_withdrawal'
export type LawyerWalletKind = 'fees' | 'savings' | 'legal_manager'
export type TaskStatus =
  | 'draft' | 'assigned' | 'in_progress' | 'submitted' | 'approved' | 'rejected' | 'completed'
  | 'new' | 'failed' | 'postponed' | 'needs_info' | 'closed' | 'waiting_assignment'
  | 'pending_assignment' | 'assignment_pending_acceptance' | 'pending_review' | 'needs_revision'

export type RequiredField =
  | 'note' | 'image' | 'pdf' | 'decision_number' | 'case_number'
  | 'date' | 'gps' | 'receipt' | 'legal_result'
  | 'text' | 'number' | 'court_decision' | 'team'

export const REQUIRED_FIELD_LABELS: Record<RequiredField, string> = {
  note: 'ملاحظة',
  image: 'صورة',
  pdf: 'ملف PDF',
  decision_number: 'رقم القرار',
  case_number: 'رقم الدعوى',
  date: 'التاريخ',
  gps: 'موقع GPS',
  receipt: 'وصل الصرف',
  legal_result: 'النتيجة القانونية',
  court_decision: 'قرار المحكمة',
  team: 'الفريق',
  text: 'نص',
  number: 'رقم',
}

export interface Court {
  id: string
  name: string
  branch_id: string | null
  is_active: boolean
  created_at: string
}

export interface ExecutionDepartment {
  id: string
  name: string
  court_id: string | null
  is_active: boolean
  created_at: string
}

export interface TaskRequiredField {
  id: string
  task_definition_id: string
  field_key: string
  field_type: RequiredField
  field_label: string | null
  is_required: boolean
  sort_order: number
  created_at: string
}
export type TaskType =
  | 'file_lawsuit' | 'notification' | 'pleading' | 'decision_ratification'
  | 'open_file' | 'summons' | 'inspection' | 'forced_appearance'
  | 'arrest_warrant' | 'arrest_warrant_broadcast' | 'imprisonment_in_absentia'
  | 'imprisonment_broadcast' | 'department_correspondence' | 'newspaper_publication'
  | 'salary_seizure' | 'first_registration' | 'file_closure'
  | 'find_address' | 'find_missing_address' | 'settlement' | 'negotiations' | 'last_payment'
  | 'criminal_lawsuit_request' | 'police_station_statement' | 'court_statement' | 'witness_statement'
export type ReceiptType = 'check' | 'bill_of_exchange' | 'trust' | 'contract' | 'other'

export interface Profile {
  id: string
  username: string | null
  full_name: string
  role: UserRole
  phone: string | null
  governorate: string | null
  identity_type: string | null
  identity_number: string | null
  identity_category: string | null
  lawyer_type?: LawyerType | null
  branch_id?: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Debtor {
  id: string
  full_name: string
  id_number: string | null
  phone: string | null
  address: string | null
  employer: string | null
  branch_id?: string | null
  branch_list_id?: string | null
  receipt_type: ReceiptType
  receipt_number: string | null
  receipt_amount: number
  remaining_amount: number
  total_expenses: number
  lawyer_fees: number
  legal_manager_fees?: number
  penalty_amount: number
  receipt_signed_legal_costs?: boolean
  total_payments: number
  required_amount: number
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface DebtorPayment {
  id: string
  debtor_id: string
  lawyer_id: string | null
  task_id: string | null
  amount: number
  payment_date: string
  payment_method: string | null
  receipt_number: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface LegalCase {
  id: string
  debtor_id: string
  case_number: string | null
  court_name: string | null
  judge_name: string | null
  case_description: string | null
  case_status: string | null
  filing_date: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  case_id: string | null
  debtor_id: string
  task_type: TaskType
  task_status: TaskStatus
  assigned_to: string | null
  governorate: string | null
  court_name: string | null
  due_date: string | null
  admin_notes: string | null
  lawyer_notes: string | null
  completed_at: string | null
  legal_result: string | null
  priority: TaskPriority
  acceptance_deadline: string | null
  completion_deadline: string | null
  reward_amount: number
  fee_status: string | null
  completion_data: Record<string, unknown> | null
  given_up_at: string | null
  give_up_reason: string | null
  assignment_rejected_by?: string | null
  accepted_at: string | null
  assignment_expires_at?: string | null
  acceptance_method?: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface Branch {
  id: string
  name: string
  city: string | null
  address: string | null
  phone: string | null
  is_active: boolean
  created_at: string
}

export interface BranchList {
  id: string
  branch_id: string
  name: string
  created_at: string
  updated_at: string
}

export interface TaskPaymentReceipt {
  id: string
  task_id: string
  lawyer_id: string
  amount: number
  status: ReceiptStatus
  notes: string | null
  review_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export interface LawyerWalletTransaction {
  id: string
  lawyer_id: string
  type: WalletTransactionType
  amount: number
  notes: string | null
  reference_id: string | null
  created_by: string | null
  created_at: string
}

export interface DebtorNote {
  id: string
  debtor_id: string
  user_id: string
  message: string | null
  attachment_url: string | null
  attachment_name: string | null
  created_at: string
}

export interface Expense {
  id: string
  debtor_id: string
  case_id: string | null
  task_id: string | null
  amount: number
  description: string
  expense_date: string
  created_by: string
  created_at: string
  updated_at: string
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  draft: 'بانتظار التكليف',
  waiting_assignment: 'بانتظار التكليف',
  pending_assignment: 'بانتظار التكليف',
  assignment_pending_acceptance: 'بانتظار قبول المحامي',
  assigned: 'مكلفة',
  in_progress: 'قيد التنفيذ',
  submitted: 'بانتظار الاعتماد',
  pending_review: 'بانتظار المراجعة',
  approved: 'معتمدة',
  rejected: 'مرفوضة',
  needs_revision: 'تحتاج تصحيح',
  completed: 'منجزة نهائياً',
  new: 'جديدة',
  failed: 'تعذر الإنجاز',
  postponed: 'مؤجلة',
  needs_info: 'تحتاج معلومات',
  closed: 'مغلقة',
}

export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  waiting_assignment: 'bg-yellow-100 text-yellow-800',
  pending_assignment: 'bg-yellow-100 text-yellow-800',
  assignment_pending_acceptance: 'bg-amber-100 text-amber-800',
  assigned: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  submitted: 'bg-purple-100 text-purple-800',
  pending_review: 'bg-purple-100 text-purple-800',
  approved: 'bg-teal-100 text-teal-800',
  rejected: 'bg-red-100 text-red-800',
  needs_revision: 'bg-orange-100 text-orange-800',
  completed: 'bg-green-100 text-green-800',
  new: 'bg-blue-100 text-blue-800',
  failed: 'bg-red-100 text-red-800',
  postponed: 'bg-gray-100 text-gray-800',
  needs_info: 'bg-orange-100 text-orange-800',
  closed: 'bg-slate-100 text-slate-600',
}

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  file_lawsuit: 'إقامة دعوى',
  notification: 'تبليغ',
  pleading: 'مرافعات',
  decision_ratification: 'تصديق قرار',
  open_file: 'فتح اضبارة',
  summons: 'تكليف بالحضور',
  inspection: 'اجراء كشف',
  forced_appearance: 'احضار جبري',
  arrest_warrant: 'امر قبض',
  arrest_warrant_broadcast: 'تعميم امر القبض',
  imprisonment_in_absentia: 'حبس غيابي',
  imprisonment_broadcast: 'تعميم الحبس',
  department_correspondence: 'مفاتحة دوائر',
  newspaper_publication: 'نشر جريده',
  salary_seizure: 'حجز راتب',
  first_registration: 'التسجيل أول من الأصالة',
  file_closure: 'ختم الإضبارة',
  find_address: 'إيجاد عنوان المدين والإنذار',
  find_missing_address: 'إيجاد عنوان المفقود والإنذار',
  settlement: 'التسوية',
  negotiations: 'المفاوضات',
  last_payment: 'اخر تسديد',
  criminal_lawsuit_request: 'تقديم طلب دعوى جزائية',
  police_station_statement: 'تدوين أقوال في مركز الشرطة',
  court_statement: 'تدوين أقوال في المحكمة',
  witness_statement: 'تدوين أقوال الشهود',
}

export const RECEIPT_TYPE_LABELS: Record<ReceiptType, string> = {
  check: 'صك',
  bill_of_exchange: 'كمبيالة',
  trust: 'وصل أمانة',
  contract: 'عقد',
  other: 'أخرى',
}

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'مدير',
  employee: 'موظف',
  accountant: 'محاسب',
  lawyer: 'محامي',
  viewer: 'مسؤول القانونية',
}

export const LAWYER_TYPE_LABELS: Record<LawyerType, string> = {
  normal: 'محامي عادي',
  general: 'محامي عام',
}

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'منخفضة',
  normal: 'عادية',
  high: 'عالية',
  urgent: 'عاجلة',
}

export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-slate-100 text-slate-500',
  normal: 'bg-blue-50 text-blue-600',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

export const RECEIPT_STATUS_LABELS: Record<ReceiptStatus, string> = {
  pending: 'بانتظار الموافقة',
  approved: 'معتمدة',
  rejected: 'مرفوضة',
}

export const WALLET_TRANSACTION_LABELS: Record<WalletTransactionType, string> = {
  accountant_transfer: 'إضافة صرفيات',
  approved_task_payment: 'إضافة أتعاب مهمة',
  manual_adjustment: 'تعديل يدوي',
  fee_payout: 'صرف أتعاب',
  transfer_from_savings: 'إضافة صرفيات',
  savings_withdrawal: 'سحب صرفيات',
  task_expense_deduction: 'خصم صرفية مهمة',
  lawyer_expense_wallet_deduction: 'خصم صرفيات معتمدة عند اعتماد إنجاز مهمة',
  legal_manager_task_bonus: 'مكافأة مسؤول القانونية (اعتماد إنجاز)',
  legal_manager_percentage_fee: 'نسبة 5% لمسؤول القانونية عند اعتماد إنجاز محامي',
  legal_manager_withdrawal: 'سحب معتمد — محفظة مسؤول القانونية',
  legal_manager_manual_deposit: 'إيداع يدوي من الإدارة إلى محفظة مسؤول القانونية',
  legal_manager_manual_withdrawal: 'سحب يدوي من الإدارة من محفظة مسؤول القانونية',
}

export const LAWYER_WALLET_LABELS: Record<LawyerWalletKind, string> = {
  fees: 'محفظة الأتعاب',
  savings: 'محفظة الصرفيات',
  legal_manager: 'محفظة مسؤول القانونية',
}
