import type { UserRole } from '@/lib/types'
import { isGeneralAccountantType } from '@/lib/accountant-type'

export const PERMISSION_DENIED_MSG = 'ليس لديك صلاحية لتنفيذ هذا الإجراء.'

export const STAFF_ROLES: UserRole[] = ['admin', 'accountant', 'employee', 'viewer']

export function isAdmin(role: string | null | undefined): boolean {
  return role === 'admin'
}

/** مسؤول القانونية — القيمة في DB: viewer */
export function isLegalManager(role: string | null | undefined): boolean {
  return role === 'viewer'
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

/** إدارة تبويب المندوبين — مدير أو مسؤول قانونية */
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
  return isAdmin(role) || isLegalManager(role)
}

export function canReadAllBranches(
  role: string | null | undefined,
  accountantType?: string | null,
): boolean {
  return isAdmin(role) || isLegalManager(role) || isGeneralAccountant(role, accountantType)
}

export function canWriteAdminData(role: string | null | undefined): boolean {
  return isAdmin(role)
}

/** تكليف المهام — مدير / موظف / مسؤول قانونية (ليس المحاسب) */
export function canAssignTasks(role: string | null | undefined): boolean {
  return isAdmin(role) || role === 'employee' || isLegalManager(role)
}

/** اعتماد/رفض الإنجازات + المهمة التالية / قضية محسومة */
export function canApproveCompletions(role: string | null | undefined): boolean {
  return isAdmin(role) || role === 'employee' || isLegalManager(role)
}

export function canReviewTasks(role: string | null | undefined): boolean {
  return canApproveCompletions(role)
}

export function canViewLawyerReports(role: string | null | undefined): boolean {
  return canViewReports(role)
}

/**
 * تعديل عام للبيانات التشغيلية/المالية.
 * مسؤول القانونية: عرض فقط (التنفيذ عبر API التكليف/الاعتماد فقط).
 */
export function canWriteData(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return !!role && STAFF_ROLES.includes(role as UserRole)
}

export function canPickAnyBranch(
  role: string | null | undefined,
  accountantType?: string | null,
): boolean {
  return canReadAllBranches(role, accountantType)
}

export function canViewAllUsersAcrossBranches(
  role: string | null | undefined,
  accountantType?: string | null,
): boolean {
  return canReadAllBranches(role, accountantType)
}

/** واجهة المدير الكاملة للعرض — مسؤول القانونية يرى مثل المدير */
export function showsFullAdminUi(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role)
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

/** إدارة حسابات (تفعيل/تعطيل) — المدير فقط؛ التعديل عبر canEditLawyerProfile */
export function canManageUsers(role: string | null | undefined): boolean {
  return isAdmin(role)
}

/** إضافة مستخدم — المدير أي أدوار؛ مسؤول القانونية محامي فقط */
export function canCreateLawyerUser(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role)
}

/** تعديل ملف مستخدم — المدير الكل؛ مسؤول القانونية محامين فقط */
export function canEditLawyerProfile(
  role: string | null | undefined,
  targetRole?: string | null,
): boolean {
  if (isAdmin(role)) return true
  if (isLegalManager(role) && targetRole === 'lawyer') return true
  return false
}

/** إضافة محكمة أو دائرة تنفيذ ضمن الفرع */
export function canAddBranchReferenceData(role: string | null | undefined): boolean {
  return canWriteData(role) || isLegalManager(role)
}

/** تعديل/حذف محاكم ودوائر — ليس لمسؤول القانونية */
export function canModifyBranchReferenceData(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return canWriteData(role)
}

/** إعدادات الفرع — مدير / موظف / محاسب (مسؤول القانونية عرض فقط عبر canWriteData) */
export function canManageSettings(role: string | null | undefined): boolean {
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

export function canAccessSettings(role: string | null | undefined): boolean {
  return canManageSettings(role) || isLegalManager(role)
}

export function canSwitchBranch(
  role: string | null | undefined,
  accountantType?: string | null,
): boolean {
  return canReadAllBranches(role, accountantType)
}

/**
 * فتح صفحات المالية للعرض.
 * المدير / الموظف / المحاسب / مسؤول القانونية (عرض فقط عبر canWriteData=false).
 */
export function canAccessFinance(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role) || isAccountant(role) || role === 'employee'
}

/** اعتماد طلبات الصرف / إدارة مالية تنفيذية — ليس لمسؤول القانونية */
export function canManageFinance(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

/** إيداع/سحب يدوي بالمحافظ — مدير/محاسب/موظف (ليس مسؤول القانونية) */
export function canManualWalletOps(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

export function canViewTaskReview(role: string | null | undefined): boolean {
  return isAdmin(role) || role === 'employee' || isLegalManager(role)
}

/** إضافة/استيراد مدينين — مدير / موظف / محاسب */
export function canAddDebtor(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

export function canImportDebtors(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

/** التقارير — قراءة لمدير / مسؤول قانونية / محاسب / موظف */
export function canViewReports(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role) || isAccountant(role) || role === 'employee'
}

export function canEditReports(role: string | null | undefined): boolean {
  if (isLegalManager(role) || isAccountant(role)) return false
  return isAdmin(role) || role === 'employee'
}

export function canCreateTaskDefinition(role: string | null | undefined): boolean {
  return isAdmin(role)
}

/** تسجيل التسديدات — مدير / محاسب / موظف (ليس مسؤول القانونية) */
export function canAddPayments(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
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

/**
 * القائمة:
 * - المدير: الكل
 * - مسؤول القانونية: نفس واجهة المدير للعرض (ما عدا محفظته الإدارية)
 * - المحاسب: روابطه فقط
 */
export function isNavVisibleForRole(href: string, role: string | null | undefined): boolean {
  if (href === '/admin/legal-manager-wallet') {
    return canViewLegalManagerWallet(role)
  }
  if (href === '/admin/delegates' || href.startsWith('/admin/delegates/')) {
    return canManageDelegates(role)
  }
  if (isAccountant(role)) {
    return ACCOUNTANT_HREFS.has(href)
  }
  // admin / legal manager / employee — كل الروابط الظاهرة في الواجهة
  return true
}

/** مسارات المحاسب المسموحة */
export function isAccountantPathAllowed(pathname: string): boolean {
  if (pathname === '/admin/dashboard' || pathname.startsWith('/admin/dashboard/')) return true
  if (pathname === '/admin/debtors' || pathname === '/admin/debtors/new') return true
  if (/^\/admin\/debtors\/[^/]+\/account\/?$/.test(pathname)) return true
  if (/^\/admin\/debtors\/[^/]+\/profile\/?$/.test(pathname)) return true
  if (/^\/admin\/debtors\/[^/]+$/.test(pathname) && !pathname.endsWith('/edit')) return true
  if (pathname.startsWith('/admin/debtors/') && pathname.includes('/edit')) return false
  if (pathname.startsWith('/admin/payments')) return true
  if (pathname.startsWith('/admin/finance')) return true
  if (pathname.startsWith('/admin/expenses')) return true
  if (pathname.startsWith('/admin/reports')) return true
  if (pathname.startsWith('/admin/accounts')) return true
  if (pathname.startsWith('/admin/activity')) return true
  if (pathname.startsWith('/admin/settings')) return true
  return false
}

/** مسار كتابة نموذجي (new/edit) */
export function isViewerWritePath(pathname: string): boolean {
  if (/\/new\/?$/.test(pathname)) return true
  if (/\/edit\/?$/.test(pathname)) return true
  return false
}

/** محفظة مسؤول القانونية في لوحة الإدارة — مدير/موظف فقط */
export function canViewLegalManagerWallet(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || role === 'employee'
}

export function canManualLegalManagerWalletOps(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || role === 'employee' || role === 'developer'
}

/**
 * مسؤول القانونية: يرى كل صفحات المدير تقريباً (عرض).
 * التنفيذ الحساس يُمنع عبر canWriteData / canDelete / canManageSettings / APIs.
 */
export function isViewerPathAllowed(_pathname: string): boolean {
  if (_pathname.startsWith('/admin/legal-manager-wallet')) return false
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
  if (isLegalManager(role) && (action === 'delete' || action === 'edit' || action === 'settings')) {
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

/** يمنع تعديلات عامة لمسؤول القانونية — التكليف/الاعتماد عبر API مخصصة */
export function writeForbiddenIfViewer(role: string | null | undefined): Response | null {
  if (isLegalManager(role)) return apiForbiddenResponse()
  return null
}
