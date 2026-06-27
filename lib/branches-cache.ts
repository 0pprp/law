import type { SupabaseClient } from '@supabase/supabase-js'
import { filterSelectableBranches } from '@/lib/branch-constants'

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

  inflight = supabase
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
    .then(({ data }) => {
      cached = filterSelectableBranches(data ?? [])
      inflight = null
      return cached
    })
    .catch(err => {
      inflight = null
      throw err
    })

  return inflight
}

export function invalidateBranchesCache(): void {
  cached = null
  inflight = null
}
