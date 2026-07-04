'use client'

import { usePathname } from 'next/navigation'
import { useAdminRole } from '@/context/admin-role'
import { isAccountant, isAccountantPathAllowed } from '@/lib/permissions'
import PermissionDenied from '@/components/PermissionDenied'

export default function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const role = useAdminRole()
  const pathname = usePathname()

  if (isAccountant(role) && !isAccountantPathAllowed(pathname)) {
    return <PermissionDenied message="لا يمكنك الوصول إلى هذه الصفحة." />
  }

  return <>{children}</>
}
