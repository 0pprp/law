'use client'

import { usePathname } from 'next/navigation'
import { useAdminRole } from '@/context/admin-role'
import { isAccountant, isAccountantPathAllowed, canViewLegalManagerWallet } from '@/lib/permissions'
import PermissionDenied from '@/components/PermissionDenied'

export default function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const role = useAdminRole()
  const pathname = usePathname()

  if (isAccountant(role) && !isAccountantPathAllowed(pathname)) {
    return <PermissionDenied message="لا يمكنك الوصول إلى هذه الصفحة." />
  }

  if (pathname.startsWith('/admin/legal-manager-wallet') && !canViewLegalManagerWallet(role)) {
    return <PermissionDenied message="رصيدك يظهر في لوحة التحكم فقط — لا يمكنك الوصول إلى صفحة المحفظة." />
  }

  return <>{children}</>
}
