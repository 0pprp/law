import type { UserRole } from '@/lib/types'

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

export function isLawyer(role: string | null | undefined): boolean {
  return role === 'lawyer'
}

export function isAdminPanelRole(role: string | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role as UserRole)
}

export function canReadAdminData(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role)
}

export function canReadAllBranches(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role)
}

export function canWriteAdminData(role: string | null | undefined): boolean {
  return isAdmin(role)
}

export function canAssignTasks(role: string | null | undefined): boolean {
  return isAdmin(role) || isAccountant(role) || role === 'employee' || isLegalManager(role)
}

export function canApproveCompletions(role: string | null | undefined): boolean {
  return isAdmin(role) || isAccountant(role) || role === 'employee' || isLegalManager(role)
}

export function canReviewTasks(role: string | null | undefined): boolean {
  return canApproveCompletions(role)
}

export function canViewLawyerReports(role: string | null | undefined): boolean {
  return canViewReports(role)
}

/** تعديل عام للبيانات — ليس لمدير القانونية */
export function canWriteData(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return !!role && STAFF_ROLES.includes(role as UserRole)
}

export function canPickAnyBranch(role: string | null | undefined): boolean {
  return canReadAllBranches(role)
}

export function canViewAllUsersAcrossBranches(role: string | null | undefined): boolean {
  return canReadAllBranches(role)
}

/** واجهة المدير الكاملة (عرض) — مدير القانونية يرى مثل المدير */
export function showsFullAdminUi(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role)
}

export function canDelete(role: string | null | undefined): boolean {
  return isAdmin(role)
}

export function canEditRecords(role: string | null | undefined): boolean {
  return isAdmin(role)
}

export function canManageUsers(role: string | null | undefined): boolean {
  return isAdmin(role)
}

/** إضافة محامي — المدير أو مسؤول القانونية (محامي فقط) */
export function canCreateLawyerUser(role: string | null | undefined): boolean {
  return isAdmin(role) || isLegalManager(role)
}

/** تعديل ملف محامي — المدير أو مسؤول القانونية للمحامين فقط */
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

export function canManageSettings(role: string | null | undefined): boolean {
  return isAdmin(role) || role === 'employee'
}

export function canAccessSettings(role: string | null | undefined): boolean {
  return canManageSettings(role)
}

export function canSwitchBranch(role: string | null | undefined): boolean {
  return canReadAllBranches(role)
}

/** عرض صفحات المالية (قراءة) — مدير القانونية يرى مثل المدير */
export function canAccessFinance(role: string | null | undefined): boolean {
  return canReadAdminData(role) || isAccountant(role) || role === 'employee'
}

export function canManageFinance(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || role === 'employee'
}

export function canManualWalletOps(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || role === 'employee'
}

export function canViewTaskReview(role: string | null | undefined): boolean {
  return canReadAdminData(role) || isAccountant(role) || role === 'employee'
}

export function canAddDebtor(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

export function canImportDebtors(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

export function canViewReports(role: string | null | undefined): boolean {
  return canReadAdminData(role) || isAccountant(role) || role === 'employee'
}

export function canEditReports(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || role === 'employee'
}

export function canCreateTaskDefinition(role: string | null | undefined): boolean {
  return isAdmin(role)
}

export function canAddPayments(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || role === 'employee'
}

const ACCOUNTANT_HREFS = new Set([
  '/admin/dashboard',
  '/admin/debtors',
  '/admin/tasks',
  '/admin/tasks/review',
  '/admin/closed-cases',
  '/admin/reports',
])

/** مدير القانونية يرى نفس قائمة المدير — الفرق في الصلاحيات التنفيذية فقط */
export function isNavVisibleForRole(href: string, role: string | null | undefined): boolean {
  if (href === '/admin/legal-manager-wallet') {
    return canViewLegalManagerWallet(role)
  }
  if (!isAccountant(role)) return true
  return ACCOUNTANT_HREFS.has(href)
}

export function isAccountantPathAllowed(pathname: string): boolean {
  if (pathname === '/admin/dashboard' || pathname.startsWith('/admin/dashboard/')) return true
  if (pathname === '/admin/debtors' || pathname === '/admin/debtors/new') return true
  if (/^\/admin\/debtors\/[^/]+\/account\/?$/.test(pathname)) return true
  if (/^\/admin\/debtors\/[^/]+\/profile\/?$/.test(pathname)) return true
  if (/^\/admin\/debtors\/[^/]+$/.test(pathname) && !pathname.endsWith('/edit')) return true
  if (pathname.startsWith('/admin/debtors/') && pathname.includes('/edit')) return false
  if (pathname === '/admin/tasks' || pathname === '/admin/tasks/review') return true
  if (pathname.startsWith('/admin/tasks/') && pathname !== '/admin/tasks/review') return false
  if (pathname.startsWith('/admin/closed-cases')) return true
  if (pathname.startsWith('/admin/reports')) return true
  return false
}

/** مسارات الكتابة — للمحاسب/المراقب القديم في proxy؛ مدير القانونية يفتح كل الصفحات للعرض */
export function isViewerWritePath(pathname: string): boolean {
  if (/\/new\/?$/.test(pathname)) return true
  if (/\/edit\/?$/.test(pathname)) return true
  return false
}

/** عرض وإدارة محفظة مسؤول القانونية — المدير/الموظف فقط (ليس مسؤول القانونية نفسه) */
export function canViewLegalManagerWallet(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || role === 'employee'
}

/** إيداع/سحب يدوي لمحفظة مدير القانونية — المدير/الأدمن/المطور فقط */
export function canManualLegalManagerWalletOps(role: string | null | undefined): boolean {
  if (isLegalManager(role)) return false
  return isAdmin(role) || role === 'employee' || role === 'developer'
}

/** مدير القانونية = نفس واجهة المدير — لا قيود على المسارات */
export function isViewerPathAllowed(_pathname: string): boolean {
  return true
}

export function accountantNotificationTotal(counts: {
  pendingReview: number
  pendingPayoutRequests: number
  pendingTaskFeeReceipts: number
  pendingExpenses: number
}): number {
  return counts.pendingReview
}

export function assertNotAccountantOrThrow(role: string | null | undefined, action: 'delete' | 'edit' | 'settings') {
  if (isAccountant(role)) {
    throw new Error(PERMISSION_DENIED_MSG)
  }
  if (isLegalManager(role)) {
    throw new Error(PERMISSION_DENIED_MSG)
  }
  if (action === 'delete' && !canDelete(role)) {
    throw new Error(PERMISSION_DENIED_MSG)
  }
  if (action === 'edit' && !canEditRecords(role)) {
    throw new Error(PERMISSION_DENIED_MSG)
  }
  if (action === 'settings' && !canAccessSettings(role)) {
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

/** يمنع التعديلات العامة — التكليف/الاعتماد عبر API مخصصة */
export function writeForbiddenIfViewer(role: string | null | undefined): Response | null {
  if (isLegalManager(role)) return apiForbiddenResponse()
  return null
}
