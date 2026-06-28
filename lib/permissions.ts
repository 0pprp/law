import type { UserRole } from '@/lib/types'

export const PERMISSION_DENIED_MSG = 'ليس لديك صلاحية لتنفيذ هذا الإجراء.'

export const STAFF_ROLES: UserRole[] = ['admin', 'accountant', 'employee', 'viewer']

export function isAdmin(role: string | null | undefined): boolean {
  return role === 'admin'
}

export function isViewer(role: string | null | undefined): boolean {
  return role === 'viewer'
}

export function isAccountant(role: string | null | undefined): boolean {
  return role === 'accountant'
}

export function isLawyer(role: string | null | undefined): boolean {
  return role === 'lawyer'
}

/** Any staff role that may open the admin panel (read-only for viewer). */
export function isAdminPanelRole(role: string | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role as UserRole)
}

/** False for مراقب عام — blocks insert/update/delete/approve/assign/import/upload. */
export function canWriteData(role: string | null | undefined): boolean {
  return !!role && !isViewer(role)
}

export function canPickAnyBranch(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'viewer'
}

/** المراقب والمدير: قائمة المستخدمين من كل الفروع (إشراف). */
export function canViewAllUsersAcrossBranches(role: string | null | undefined): boolean {
  return canPickAnyBranch(role)
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

/** View settings (viewer: read-only). */
export function canAccessSettings(role: string | null | undefined): boolean {
  return isAdmin(role) || isViewer(role)
}

export function canSwitchBranch(role: string | null | undefined): boolean {
  return canPickAnyBranch(role)
}

export function canAccessFinance(role: string | null | undefined): boolean {
  return isAdmin(role) || role === 'employee' || isViewer(role)
}

export function canManualWalletOps(role: string | null | undefined): boolean {
  return isAdmin(role) || role === 'employee'
}

export function canAssignTasks(role: string | null | undefined): boolean {
  if (isViewer(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

export function canReviewTasks(role: string | null | undefined): boolean {
  if (isViewer(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

export function canAddDebtor(role: string | null | undefined): boolean {
  if (isViewer(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

export function canImportDebtors(role: string | null | undefined): boolean {
  if (isViewer(role)) return false
  return isAdmin(role) || isAccountant(role) || role === 'employee'
}

export function canViewReports(role: string | null | undefined): boolean {
  return isAdmin(role) || isAccountant(role) || role === 'employee' || isViewer(role)
}

export function canEditReports(role: string | null | undefined): boolean {
  if (isViewer(role)) return false
  return isAdmin(role) || role === 'employee'
}

export function canCreateTaskDefinition(role: string | null | undefined): boolean {
  return isAdmin(role)
}

export function canAddPayments(role: string | null | undefined): boolean {
  if (isViewer(role)) return false
  return isAdmin(role) || role === 'employee'
}

export type NavItemDef = {
  label: string
  href: string
  exact?: boolean
  iconKey?: string
}

const ACCOUNTANT_HREFS = new Set([
  '/admin/dashboard',
  '/admin/debtors',
  '/admin/tasks',
  '/admin/tasks/review',
  '/admin/closed-cases',
  '/admin/reports',
])

export function isNavVisibleForRole(href: string, role: string | null | undefined): boolean {
  if (isViewer(role)) return true
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

/** Block viewer from create/edit mutation URLs. */
export function isViewerWritePath(pathname: string): boolean {
  if (/\/new\/?$/.test(pathname)) return true
  if (/\/edit\/?$/.test(pathname)) return true
  return false
}

export function isViewerPathAllowed(pathname: string): boolean {
  if (isViewerWritePath(pathname)) return false
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
  if (isViewer(role)) {
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

export function writeForbiddenIfViewer(role: string | null | undefined): Response | null {
  if (isViewer(role)) return apiForbiddenResponse()
  return null
}
