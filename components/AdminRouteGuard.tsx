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
  canViewLegalManagerWallet,
  canManageDelegates,
} from '@/lib/permissions'
import PermissionDenied from '@/components/PermissionDenied'

/**
 * حراسة المسارات:
 * - المدير: لا قيود هنا
 * - المحاسب: مسارات مالية + مدينين فقط
 * - مسؤول متابعة التسديد: لوحته + التسديدات + كشف الحساب فقط
 * - مسؤول الدعاوى المدنية / مسؤول الجزائيات: عرض؛ التنفيذ عبر canWriteData / APIs
 */
export default function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const role = useAdminRole()
  const pathname = usePathname()

  if (isPaymentFollowUp(role) && !isPaymentFollowUpPathAllowed(pathname)) {
    return <PermissionDenied message="صلاحيات متابعة التسديد: لوحة جاري التسديد والتسديدات فقط." />
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
    return <PermissionDenied message="رصيدك يظهر في لوحة التحكم فقط — لا يمكنك الوصول إلى صفحة المحفظة." />
  }

  return <>{children}</>
}
