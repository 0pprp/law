'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchBranchLists } from '@/lib/branch-lists'
import type { BranchList } from '@/lib/branch-lists'

export function useBranchLists(branchId: string | null | undefined): {
  lists: BranchList[]
  loading: boolean
  reload: () => void
} {
  const [lists, setLists] = useState<BranchList[]>([])
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!branchId) {
      setLists([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchBranchLists(createClient(), branchId).then(data => {
      if (!cancelled) {
        setLists(data)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [branchId, tick])

  return {
    lists,
    loading,
    reload: () => setTick(t => t + 1),
  }
}
