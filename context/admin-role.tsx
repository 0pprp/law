'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { UserRole } from '@/lib/types'
import type { AccountantType } from '@/lib/accountant-type'
import { normalizeAccountantType } from '@/lib/accountant-type'

export interface AdminRoleState {
  role: UserRole
  accountantType: AccountantType
}

const AdminRoleContext = createContext<AdminRoleState>({
  role: 'employee',
  accountantType: 'branch',
})

export function AdminRoleProvider({
  role,
  accountantType,
  children,
}: {
  role: UserRole
  accountantType?: string | null
  children: ReactNode
}) {
  return (
    <AdminRoleContext.Provider
      value={{
        role,
        accountantType: normalizeAccountantType(accountantType),
      }}
    >
      {children}
    </AdminRoleContext.Provider>
  )
}

export function useAdminRole(): UserRole {
  return useContext(AdminRoleContext).role
}

export function useAdminRoleState(): AdminRoleState {
  return useContext(AdminRoleContext)
}
