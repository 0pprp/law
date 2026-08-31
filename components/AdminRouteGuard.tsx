'use client'

import { usePathname } from 'next/navigation'
import { useAdminRole } from '@/context/admin-role'
import {
  isAccountant,
  isAccountantPathAllowed,
  isLegalManager,
  isCriminalLegalManager,
  isViewerPathAllowed,
  isCriminalLegalManagerPathAllowed,
  isPaymentFollowUp,
  isPaymentFollowUpPathAllowed,
  isChiefAccountant,
  isChiefAccountantPathAllowed,
  canViewLegalManagerWallet,
  canManageDelegates,
  canManageTaskManagement,
  canManageSpecialStatuses,
} from '@/lib/permissions'
import PermissionDenied from '@/components/PermissionDenied'

/**
 * حراسة المسارات:
 * - المدير: لا قيود هنا
 * - المحاسب: مسارات مالية + مدينين فقط
 * - مسؤول متابعة التسديد: لوحته + التسديدات + كشف الحساب فقط
 * - المحاسب الرئيسي: المدينون المعيَّنون فقط
 * - مسؤول الدعاوى المدنية / مسؤول الجزائيات: عرض؛ التنفيذ عبر canWriteData / APIs
 */
export default function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const role = useAdminRole()
  const pathname = usePathname()

  if (pathname.startsWith('/admin/task-management') && !canManageTaskManagement(role)) {
    return <PermissionDenied message="إدارة المهام: للمدير أو المحاسب فقط." />
  }

  if (pathname.startsWith('/admin/special-statuses') && !canManageSpecialStatuses(role)) {
    return <PermissionDenied message="متابعة القانونية: للمدير أو مسؤول الدعاوى المدنية فقط." />
  }

  if (isPaymentFollowUp(role) && !isPaymentFollowUpPathAllowed(pathname)) {
    return <PermissionDenied message="صلاحيات متابعة التسديد: لوحة جاري التسديد والتسديدات فقط." />
  }

  if (isChiefAccountant(role) && !isChiefAccountantPathAllowed(pathname)) {
    return <PermissionDenied message="صلاحيات المحاسب الرئيسي: المدينون المعيَّنون فقط." />
  }

  if (isAccountant(role) && !isAccountantPathAllowed(pathname)) {
    return <PermissionDenied message="صلاحيات المحاسب: المدينون والمالية فقط." />
  }

  if (isLegalManager(role) && !isViewerPathAllowed(pathname)) {
    return <PermissionDenied message="لا يمكنك الوصول إلى هذه الصفحة." />
  }

  if (isCriminalLegalManager(role) && !isCriminalLegalManagerPathAllowed(pathname)) {
    return <PermissionDenied message="مسؤول الجزائيات: المالية غير متاحة لقسمك." />
  }

  if (pathname.startsWith('/admin/delegates') && !canManageDelegates(role)) {
    return <PermissionDenied message="صلاحيات المندوبين: المدير أو مسؤول الدعاوى المدنية فقط." />
  }

  if (pathname.startsWith('/admin/legal-manager-wallet') && !canViewLegalManagerWallet(role)) {
    return <PermissionDenied message="صفحة محفظة مسؤول القانونية للمدير والموظفين فقط." />
  }

  return <>{children}</>
}
