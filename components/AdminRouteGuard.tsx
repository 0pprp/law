'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useAdminRole } from '@/context/admin-role'
import { isAccountant, isViewer, isAccountantPathAllowed, isViewerPathAllowed } from '@/lib/permissions'
import PermissionDenied from '@/components/PermissionDenied'

export default function AdminRouteGuard({ children }: { children: React.ReactNode }) {
  const role = useAdminRole()
  const pathname = usePathname()

  if (isViewer(role) && !isViewerPathAllowed(pathname)) {
    return <PermissionDenied />
  }

  if (isAccountant(role) && !isAccountantPathAllowed(pathname)) {
    return <PermissionDenied message="لا يمكنك الوصول إلى هذه الصفحة." />
  }

  return <>{children}</>
}
