'use client'

import { useAdminRole } from '@/context/admin-role'
import { canWriteData } from '@/lib/permissions'

export function useCanWrite(): boolean {
  return canWriteData(useAdminRole())
}
