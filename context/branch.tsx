'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface BranchCtxValue {
  branchId: string | null
  branchName: string | null
  setBranch: (id: string, name: string) => void
}

export const BranchContext = createContext<BranchCtxValue>({
  branchId: null,
  branchName: null,
  setBranch: () => {},
})

export function BranchProvider({
  initialBranchId,
  initialBranchName,
  children,
}: {
  initialBranchId: string | null
  initialBranchName: string | null
  children: ReactNode
}) {
  const [branchId, setBranchId] = useState<string | null>(initialBranchId)
  const [branchName, setBranchName] = useState<string | null>(initialBranchName)

  const setBranch = useCallback((id: string, name: string) => {
    setBranchId(id)
    setBranchName(name)
  }, [])

  return (
    <BranchContext.Provider value={{ branchId, branchName, setBranch }}>
      {children}
    </BranchContext.Provider>
  )
}

export function useBranchId(): string | null {
  return useContext(BranchContext).branchId
}

export function useBranch() {
  return useContext(BranchContext)
}
