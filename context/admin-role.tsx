'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { UserRole } from '@/lib/types'

const AdminRoleContext = createContext<UserRole>('employee')

export function AdminRoleProvider({ role, children }: { role: UserRole; children: ReactNode }) {
  return <AdminRoleContext.Provider value={role}>{children}</AdminRoleContext.Provider>
}

export function useAdminRole(): UserRole {
  return useContext(AdminRoleContext)
}
