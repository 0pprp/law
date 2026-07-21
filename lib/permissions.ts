import type { UserRole } from '@/lib/types'
import { isGeneralAccountantType } from '@/lib/accountant-type'

export const PERMISSION_DENIED_MSG = 'ليس لديك صلاحية لتنفيذ هذا الإجراء.'

export const STAFF_ROLES: UserRole[] = [
  'admin',
  'accountant',
  'employee',
  'viewer',
  'payment_follow_up',
  'criminal_legal_manager',
]

/** مسؤول متابعة التسديد */
export function isPaymentFollowUp(role: string | null | undefined): boolean {
  return role === 'payment_follow_up'
}

export function isAdmin(role: string | null | undefined): boolean {
  return role === 'admin'
}

/** مسؤول الدعاوى المدنية — القيمة في DB: viewer */
export function isLegalManager(role: string | null | undefined): boolean {
  return role === 'viewer'
}

/** مسؤول الجزائيات */
export function isCriminalLegalManager(role: string | null | undefined): boolean {
  return role === 'criminal_legal_manager'
}

/** أي مسؤول قسم (مدني أو جزائي) — صلاحيات متشابهة مع نطاق مختلف */
export function isAnyLegalManager(role: string | null | undefined): boolean {
  return isLegalManager(role) || isCriminalLegalManager(role)
}

export function isViewer(role: string | null | undefined): boolean {
  return isLegalManager(role)
}

/** alias */
export function isAuditor(role: string | null | undefined): boolean {
  return isLegalManager(role)
}

export function isAccountant(role: string | null | undefined): boolean {
  return role === 'accountant'
}

/** محاسب عام — نفس صلاحيات المحاسب مع رؤية كل الفروع فقط */
export function isGeneralAccountant(
  role: string | null | undefined,
  accountantType?: string | null,
): boolean {
  return isAccountant(role) && isGeneralAccountantType(accountantType)
}

export function isLawyer(role: string | null | undefined): boolean {
  return role === 'lawyer'
}

export function isDelegate(role: string | null | undefined): boolean {
  return role === 'delegate'
}

/** بوابة ميدانية (محامي أو مندوب) — ليست لوحة إدارة */
export function isFieldWorkerRole(role: string | null | undefined): boolean {
  return isLawyer(role) || isDelegate(role)
}

/** إدارة تبويب المندوبين — مدير أو مسؤول الدعاوى المدنية فقط (الجزائي بلا قوائم/مندوبين) */
export function canManageDelegates(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role)
}

/** تغيير حالة التبليغ / صرف أتعاب المندوب */
export function canManageDelegateFees(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role)
}

export function isAdminPanelRole(role: string | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role as UserRole)
}

export function canReadAdminData(role: string | null | undefined): boolean {
  return isAdmin(role) || isAnyLegalManager(role)
}

export function canReadAllBranches(
  role: string | null | undefined,
  accountantType?: string | null,
): boolean {
  return (
    isAdmin(role)
    || isAnyLegalManager(role)
    || isGeneralAccountant(role, accountantType)
    || isPaymentFollowUp(role)
  )
}

export function canWriteAdminData(role: string | null | undefined): boolean {
  return isAdmin(role)
}

/** تكليف المهام — مدير / موظف / مسؤولو الأقسام (ليس المحاسب) */
export function canAssignTasks(role: string | null | undefined): boolean {
  return isAdmin(role) || role === 'employee' || isAnyLegalManager(role)
}

/** اعتماد/رفض الإنجازات + المهمة التالية / قضية محسومة */
export function canApproveCompletions(role: string | null | undefined): boolean {
  return isAdmin(role) || role === 'employee' || isAnyLegalManager(role)
}

export function canReviewTasks(role: string | null | undefined): boolean {
  return canApproveCompletions(role)
}

export function canViewLawyerReports(role: string | null | undefined): boolean {
  return canViewReports(role)
}

/**
 * تعديل عام للبيانات التشغيلية/المالية.
 * مسؤولو الأقسام: عرض فقط (التنفيذ عبر API التكليف/الاعتماد فقط).
 */
export function canWriteData(role: string | null | undefined): boolean {
  if (isAnyLegalManager(role)) return false
  return !!role && STAFF_ROLES.includes(role as UserRole)
}

export function canPickAnyBranch(
  role: string | null | undefined,
  accountantType?: string | null,
): boolean {
  return canReadAllBranches(role, accountantType)
}

/**
 * فلتر واجهة «الكل» (كل الفروع) — ليس فرعاً في قاعدة البيانات.
 * المدير + المحاسب العام + مسؤول متابعة التسديد + مسؤول الدعاوى المدنية.
 */
export function canUseViewAllBranchesFilter(
  role: string | null | undefined,
  accountantType?: string | null,
): boolean {
  return (
    isAdmin(role)
    || isGeneralAccountant(role, accountantType)
    || isPaymentFollowUp(role)
    || isLegalManager(role)
  )
}

export function canViewAllUsersAcrossBranches(
  role: string | null | undefined,
  accountantType?: string | null,
): boolean {
  return canReadAllBranches(role, accountantType)
}

/** واجهة المدير الكاملة للعرض — مسؤولو الأقسام يرون مثل المدير ضمن نطاقهم */
export function showsFullAdminUi(role: string | null | undefined): boolean {
  return isAdmin(role) || isAnyLegalManager(role)
}

export function canDelete(role: string | null | undefined): boolean {
  return isAdmin(role)
}

/** حذف أو تعطيل مستخدم/مندوب — المدير فقط */
export function canDeleteUsers(role: string | null | undefined): boolean {
  return isAdmin(role)
}

export function canEditRecords(role: string | null | undefined): boolean {
  return isAdmin(role)
}

/** تعديل بيانات المدين — المدير والمحاسب ومسؤولو الأقسام (القسم يُفرض في API) */
export function canEditDebtor(role: string | null | undefined): boolean {
  return isAdmin(role) || isAccountant(role) || isAnyLegalManager(role)
}

/** إدارة حسابات (تفعيل/تعطيل) — المدير فقط؛ التعديل عبر canEditLawyerProfile */
export function canManageUsers(role: string | null | undefined): boolean {
  return isAdmin(role)
}

/** إضافة مستخدم — المدير أي أدوار؛ مسؤولو الأقسام محامي قسمهم فقط */
export function canCreateLawyerUser(role: string | null | undefined): boolean {
  return isAdmin(role) || isAnyLegalManager(role)
}

/** تعديل ملف مستخدم — المدير الكل؛ مسؤولو الأقسام محامين فقط */
export function canEditLawyerProfile(
  role: string | null | undefined,
  targetRole?: string | null,
): boolean {
  if (isAdmin(role)) return true
  if (isAnyLegalManager(role) && targetRole === 'lawyer') return true
  return false
}

/** إضافة محكمة أو دائرة تنفيذ ضمن الفرع */
export function canAddBranchReferenceData(role: string | null | undefined): boolean {
  return canWriteData(role) || isAnyLegalManager(role)
}

/** تعديل/حذف محاكم ودوائر — ليس لمسؤولي الأقسام */
export function canModifyBranchReferenceData(role: string | null | undefined): boolean {
  if (isAnyLegalManager(role)) return false
  return canWriteData(role)
}

/** إعدادات الفرع — مدير / موظف / محاسب (مسؤولو الأقسام عرض فقط عبر canWriteData) */
export function canManageSettings(role: string | null | undefined): boolean {
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

export function canAccessSettings(role: string | null | undefined): boolean {
  return canManageSettings(role) || isAnyLegalManager(role)
}

export function canSwitchBranch(
  role: string | null | undefined,
  accountantType?: string | null,
): boolean {
  return canReadAllBranches(role, accountantType)
}

/**
 * فتح صفحات المالية للعرض.
 * المدير / الموظف / المحاسب / مسؤول الدعاوى المدنية (عرض فقط).
 * مسؤول الجزائيات: لا يرى المالية — عمليات + تقارير فقط.
 */
export function canAccessFinance(role: string | null | undefined): boolean {
  if (isCriminalLegalManager(role)) return false
  return isAdmin(role) || isLegalManager(role) || isAccountant(role) || role === 'employee'
}

/** اعتماد طلبات الصرف / إدارة مالية تنفيذية — ليس لمسؤولي الأقسام */
export function canManageFinance(role: string | null | undefined): boolean {
  if (isAnyLegalManager(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

/** إيداع/سحب يدوي بالمحافظ — مدير/محاسب/موظف (ليس مسؤولي الأقسام) */
export function canManualWalletOps(role: string | null | undefined): boolean {
  if (isAnyLegalManager(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

export function canViewTaskReview(role: string | null | undefined): boolean {
  return isAdmin(role) || role === 'employee' || isAnyLegalManager(role)
}

/** إضافة مدينين — مدير / موظف / محاسب / مسؤولو الأقسام (القسم يُفرض في API) */
export function canAddDebtor(role: string | null | undefined): boolean {
  return isAdmin(role) || isAccountant(role) || role === 'employee' || isAnyLegalManager(role)
}

export function canImportDebtors(role: string | null | undefined): boolean {
  if (isAnyLegalManager(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

/** استيراد مدينين جزائيين — مدير / محاسب / مسؤول الجزائيات فقط */
export function canImportCriminalDebtors(role: string | null | undefined): boolean {
  return isAdmin(role) || isAccountant(role) || role === 'criminal_legal_manager'
}

/** التقارير — قراءة لمدير / مسؤولي الأقسام / محاسب / موظف */
export function canViewReports(role: string | null | undefined): boolean {
  return isAdmin(role) || isAnyLegalManager(role) || isAccountant(role) || role === 'employee'
}

export function canEditReports(role: string | null | undefined): boolean {
  if (isAnyLegalManager(role) || isAccountant(role)) return false
  return isAdmin(role) || role === 'employee'
}

export function canCreateTaskDefinition(role: string | null | undefined): boolean {
  return isAdmin(role)
}

/** تسجيل التسديدات — مدير / محاسب / موظف / مسؤول متابعة التسديد (ليس مسؤولي الأقسام) */
export function canAddPayments(role: string | null | undefined): boolean {
  if (isAnyLegalManager(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee' || isPaymentFollowUp(role)
}

/** كارد جاري التسديد في لوحة التحكم — مدير ومسؤول الدعاوى المدنية (ليس الجزائي) */
export function canViewPaymentInProgressCard(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role)
}

/** تحويل المدين إلى جاري التسديد — مدير ومسؤول الدعاوى المدنية */
export function canMoveToPaymentInProgress(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role)
}

/** إرسال طلب عدم التزام — مسؤول متابعة التسديد فقط */
export function canSubmitPaymentNoncomplianceRequest(role: string | null | undefined): boolean {
  return isPaymentFollowUp(role)
}

/** مراجعة طلبات عدم الالتزام — مدير ومسؤول المدنية والمحاسب (ليس الجزائي) */
export function canReviewPaymentNoncomplianceRequest(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role) || isAccountant(role)
}

/**
 * محاسب: مدينون + مالية + تقارير + سجل النشاط + إعدادات الفرع.
 * بدون تكليف/مراجعة/مستخدمين.
 */
const ACCOUNTANT_HREFS = new Set([
  '/admin/dashboard',
  '/admin/debtors',
  '/admin/payments',
  '/admin/finance',
  '/admin/expenses',
  '/admin/reports',
  '/admin/accounts',
  '/admin/activity',
  '/admin/settings',
])

/** مسؤول متابعة التسديد: لوحته + التسديدات + كشف حساب المدين فقط */
const PAYMENT_FOLLOW_UP_HREFS = new Set([
  '/admin/payment-follow-up',
  '/admin/payments',
])

/**
 * القائمة:
 * - المدير: الكل
 * - مسؤول الدعاوى المدنية: واجهة المدير للعرض (ما عدا محفظة مسؤول المدنية)
 * - مسؤول الجزائيات: عمليات + تقارير + نظام (بدون مالية / مندوبين)
 * - المحاسب: روابطه فقط
 * - مسؤول متابعة التسديد: لوحته والتسديدات فقط
 */
export function isNavVisibleForRole(href: string, role: string | null | undefined): boolean {
  if (href === '/admin/legal-manager-wallet') {
    return canViewLegalManagerWallet(role)
  }
  if (href === '/admin/delegates' || href.startsWith('/admin/delegates/')) {
    return canManageDelegates(role)
  }
  if (isPaymentFollowUp(role)) {
    return PAYMENT_FOLLOW_UP_HREFS.has(href)
  }
  if (isAccountant(role)) {
    return ACCOUNTANT_HREFS.has(href)
  }
  // إخفاء لوحة متابعة التسديد عن غير أصحاب الدور (المدير/المدنية يرون الكارد في الداشبورد)
  if (href === '/admin/payment-follow-up') {
    return isPaymentFollowUp(role)
  }
  if (isCriminalLegalManager(role)) {
    if (
      href === '/admin/payments'
      || href === '/admin/finance'
      || href === '/admin/expenses'
      || href === '/admin/legal-manager-wallet'
    ) {
      return false
    }
  }
  // admin / legal managers / employee — الروابط الظاهرة
  return true
}

/** مسارات المحاسب المسموحة */
export function isAccountantPathAllowed(pathname: string): boolean {
  if (pathname === '/admin/dashboard' || pathname.startsWith('/admin/dashboard/')) return true
  if (pathname === '/admin/debtors' || pathname === '/admin/debtors/new') return true
  if (/^\/admin\/debtors\/[^/]+\/account\/?$/.test(pathname)) return true
  if (/^\/admin\/debtors\/[^/]+\/profile\/?$/.test(pathname)) return true
  if (/^\/admin\/debtors\/[^/]+\/edit\/?$/.test(pathname)) return true
  if (/^\/admin\/debtors\/[^/]+$/.test(pathname) && !pathname.endsWith('/edit')) return true
  if (pathname.startsWith('/admin/payments')) return true
  if (pathname.startsWith('/admin/finance')) return true
  if (pathname.startsWith('/admin/expenses')) return true
  if (pathname.startsWith('/admin/reports')) return true
  if (pathname.startsWith('/admin/accounts')) return true
  if (pathname.startsWith('/admin/activity')) return true
  if (pathname.startsWith('/admin/settings')) return true
  return false
}

/** مسارات مسؤول متابعة التسديد */
export function isPaymentFollowUpPathAllowed(pathname: string): boolean {
  if (pathname === '/admin/payment-follow-up' || pathname.startsWith('/admin/payment-follow-up/')) return true
  if (pathname.startsWith('/admin/payments')) return true
  if (/^\/admin\/debtors\/[^/]+\/account\/?$/.test(pathname)) return true
  return false
}

/** مسار كتابة نموذجي (new/edit) */
export function isViewerWritePath(pathname: string): boolean {
  if (/\/new\/?$/.test(pathname)) return true
  if (/\/edit\/?$/.test(pathname)) return true
  return false
}

/** محفظة مسؤول الدعاوى المدنية في لوحة الإدارة — مدير/موظف فقط */
export function canViewLegalManagerWallet(role: string | null | undefined): boolean {
  if (isAnyLegalManager(role)) return false
  return isAdmin(role) || role === 'employee'
}

export function canManualLegalManagerWalletOps(role: string | null | undefined): boolean {
  if (isAnyLegalManager(role)) return false
  return isAdmin(role) || role === 'employee' || role === 'developer'
}

/**
 * مسؤولو الأقسام: يرون صفحات المدير تقريباً (عرض).
 * التنفيذ الحساس يُمنع عبر canWriteData / canDelete / canManageSettings / APIs.
 * مسؤول الجزائيات: بدون مندوبين وبدون محفظة مسؤول المدنية.
 */
export function isViewerPathAllowed(_pathname: string): boolean {
  if (_pathname.startsWith('/admin/legal-manager-wallet')) return false
  return true
}

/**
 * مسؤول الجزائيات: لوحة + عمليات + تقارير + إعدادات الفرع + سجل النشاط.
 * بدون مالية (تسديدات/أتعاب/صرفيات) وبدون مندوبين.
 */
export function isCriminalLegalManagerPathAllowed(pathname: string): boolean {
  if (pathname.startsWith('/admin/legal-manager-wallet')) return false
  if (pathname.startsWith('/admin/delegates')) return false
  if (pathname.startsWith('/admin/payments')) return false
  if (pathname.startsWith('/admin/finance')) return false
  if (pathname.startsWith('/admin/expenses')) return false
  if (pathname.startsWith('/admin/accounts')) return false
  if (pathname.startsWith('/admin/payment-follow-up')) return false
  if (pathname.startsWith('/admin/dashboard/payment-in-progress')) return false
  if (pathname.startsWith('/admin/dashboard/noncompliance')) return false
  return true
}

/** إشعارات المحاسب — مالية */
export function accountantNotificationTotal(counts: {
  pendingReview: number
  pendingPayoutRequests: number
  pendingTaskFeeReceipts: number
  pendingExpenses: number
}): number {
  return counts.pendingPayoutRequests + counts.pendingTaskFeeReceipts + counts.pendingExpenses
}

export function assertNotAccountantOrThrow(role: string | null | undefined, action: 'delete' | 'edit' | 'settings') {
  if (action === 'delete' && !canDelete(role)) {
    throw new Error(PERMISSION_DENIED_MSG)
  }
  if (action === 'edit' && !canEditRecords(role)) {
    throw new Error(PERMISSION_DENIED_MSG)
  }
  if (action === 'settings' && !canManageSettings(role)) {
    throw new Error(PERMISSION_DENIED_MSG)
  }
  if (isAnyLegalManager(role) && (action === 'delete' || action === 'edit' || action === 'settings')) {
    throw new Error(PERMISSION_DENIED_MSG)
  }
}

export async function getProfileRole(supabase: { from: (t: string) => any }, userId: string): Promise<UserRole | null> {
  const { data } = await supabase.from('profiles').select('role').eq('id', userId).single()
  return (data?.role as UserRole) ?? null
}

export function apiForbiddenResponse() {
  return Response.json({ error: PERMISSION_DENIED_MSG }, { status: 403 })
}

/** يمنع تعديلات عامة لمسؤولي الأقسام — التكليف/الاعتماد عبر API مخصصة */
export function writeForbiddenIfViewer(role: string | null | undefined): Response | null {
  if (isAnyLegalManager(role)) return apiForbiddenResponse()
  return null
}
