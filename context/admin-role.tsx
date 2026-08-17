'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { UserRole } from '@/lib/types'
import type { AccountantType } from '@/lib/accountant-type'
import { normalizeAccountantType } from '@/lib/accountant-type'

export interface AdminRoleState {
  role: UserRole
  accountantType: AccountantType
  canAccessCivil: boolean
  canAccessCriminal: boolean
}

const AdminRoleContext = createContext<AdminRoleState>({
  role: 'employee',
  accountantType: 'branch',
  canAccessCivil: true,
  canAccessCriminal: true,
})

export function AdminRoleProvider({
  role,
  accountantType,
  canAccessCivil,
  canAccessCriminal,
  children,
}: {
  role: UserRole
  accountantType?: string | null
  canAccessCivil?: boolean | null
  canAccessCriminal?: boolean | null
  children: ReactNode
}) {
  const isCriminalLm = role === 'criminal_legal_manager'
  return (
    <AdminRoleContext.Provider
      value={{
        role,
        accountantType: normalizeAccountantType(accountantType),
        canAccessCivil: canAccessCivil ?? !isCriminalLm,
        canAccessCriminal: canAccessCriminal ?? isCriminalLm,
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
