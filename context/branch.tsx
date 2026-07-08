'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { cacheClear } from '@/lib/query-cache'

interface BranchCtxValue {
  branchId: string | null
  branchName: string | null
  /** null branchId with canPick = عرضين كل الفروع */
  viewAllBranches: boolean
  setBranch: (id: string, name: string) => void
  setViewAllBranches: () => void
}

export const BranchContext = createContext<BranchCtxValue>({
  branchId: null,
  branchName: null,
  viewAllBranches: false,
  setBranch: () => {},
  setViewAllBranches: () => {},
})

export function BranchProvider({
  initialBranchId,
  initialBranchName,
  initialViewAll = false,
  children,
}: {
  initialBranchId: string | null
  initialBranchName: string | null
  initialViewAll?: boolean
  children: ReactNode
}) {
  const [branchId, setBranchId] = useState<string | null>(initialBranchId)
  const [branchName, setBranchName] = useState<string | null>(initialBranchName)
  const [viewAllBranches, setViewAll] = useState(Boolean(initialViewAll && !initialBranchId))

  const setBranch = useCallback((id: string, name: string) => {
    setBranchId(id)
    setBranchName(name)
    setViewAll(false)
    cacheClear()
  }, [])

  const setViewAllBranches = useCallback(() => {
    setBranchId(null)
    setBranchName(null)
    setViewAll(true)
    cacheClear()
  }, [])

  return (
    <BranchContext.Provider value={{ branchId, branchName, viewAllBranches, setBranch, setViewAllBranches }}>
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
