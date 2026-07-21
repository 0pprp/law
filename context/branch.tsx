'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { cacheClear } from '@/lib/query-cache'

interface BranchCtxValue {
  branchId: string | null
  branchName: string | null
  /** null branchId with canPick = عرض كل الفروع */
  viewAllBranches: boolean
  /** فلتر القائمة العلوي — null = الكل */
  listId: string | null
  listName: string | null
  setBranch: (id: string, name: string) => void
  setViewAllBranches: () => void
  setList: (id: string, name: string) => void
  clearList: () => void
}

export const BranchContext = createContext<BranchCtxValue>({
  branchId: null,
  branchName: null,
  viewAllBranches: false,
  listId: null,
  listName: null,
  setBranch: () => {},
  setViewAllBranches: () => {},
  setList: () => {},
  clearList: () => {},
})

export function BranchProvider({
  initialBranchId,
  initialBranchName,
  initialViewAll = false,
  initialListId = null,
  initialListName = null,
  children,
}: {
  initialBranchId: string | null
  initialBranchName: string | null
  initialViewAll?: boolean
  initialListId?: string | null
  initialListName?: string | null
  children: ReactNode
}) {
  const [branchId, setBranchId] = useState<string | null>(initialBranchId)
  const [branchName, setBranchName] = useState<string | null>(initialBranchName)
  const [viewAllBranches, setViewAll] = useState(Boolean(initialViewAll && !initialBranchId))
  const [listId, setListId] = useState<string | null>(
    initialBranchId && initialListId ? initialListId : null,
  )
  const [listName, setListName] = useState<string | null>(
    initialBranchId && initialListId ? initialListName : null,
  )

  const clearListState = useCallback(() => {
    setListId(null)
    setListName(null)
  }, [])

  const setBranch = useCallback((id: string, name: string) => {
    setBranchId(id)
    setBranchName(name)
    setViewAll(false)
    // القوائم مرتبطة بالفرع — إعادة تعيين عند التغيير
    setListId(null)
    setListName(null)
    cacheClear()
  }, [])

  const setViewAllBranches = useCallback(() => {
    setBranchId(null)
    setBranchName(null)
    setViewAll(true)
    setListId(null)
    setListName(null)
    cacheClear()
  }, [])

  const setList = useCallback((id: string, name: string) => {
    setListId(id)
    setListName(name)
    cacheClear()
  }, [])

  const clearList = useCallback(() => {
    clearListState()
    cacheClear()
  }, [clearListState])

  return (
    <BranchContext.Provider
      value={{
        branchId,
        branchName,
        viewAllBranches,
        listId,
        listName,
        setBranch,
        setViewAllBranches,
        setList,
        clearList,
      }}
    >
      {children}
    </BranchContext.Provider>
  )
}

export function useBranchId(): string | null {
  return useContext(BranchContext).branchId
}

export function useBranchListId(): string | null {
  return useContext(BranchContext).listId
}

export function useBranch() {
  return useContext(BranchContext)
}
