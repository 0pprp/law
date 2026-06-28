import type { SupabaseClient } from '@supabase/supabase-js'
import { APPROVED_BRANCH_NAMES, filterSelectableBranches } from '@/lib/branch-constants'

export interface BranchOption {
  id: string
  name: string
}

let cached: BranchOption[] | null = null
let inflight: Promise<BranchOption[]> | null = null

export async function fetchSelectableBranches(
  supabase: SupabaseClient,
): Promise<BranchOption[]> {
  if (cached) return cached
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const { data } = await supabase
        .from('branches')
        .select('id, name')
        .eq('is_active', true)
        .in('name', [...APPROVED_BRANCH_NAMES])
        .order('name')
      cached = filterSelectableBranches(data ?? [])
      return cached
    } finally {
      inflight = null
    }
  })()

  return inflight
}

export function invalidateBranchesCache(): void {
  cached = null
  inflight = null
}

/** Force fresh branch list after DB cleanup (legacy alias removal). */
export function resetBranchesCache(): void {
  invalidateBranchesCache()
}
