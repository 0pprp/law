import type { SupabaseClient } from '@supabase/supabase-js'

/** Same query base as /admin/lawyers (users page): profiles in branch, no role filter in SQL. */
export interface BranchProfileRow {
  id: string
  full_name: string
  role: string | null
  branch_id: string | null
  is_active?: boolean | null
  active?: boolean | null
  status?: string | null
}

const LAWYER_ROLES = new Set(['lawyer', 'محامي', 'attorney'])

export function isLawyerRole(role: string | null | undefined): boolean {
  if (!role) return false
  return LAWYER_ROLES.has(role.trim().toLowerCase())
}

/** Matches login logic: only explicit false / inactive status excludes the user. */
export function isProfileActive(profile: BranchProfileRow): boolean {
  if (profile.is_active === false) return false
  if (profile.active === false) return false
  if (profile.status != null) {
    const s = String(profile.status).trim().toLowerCase()
    if (s === 'inactive' || s === 'disabled' || s === 'معطل') return false
  }
  return true
}

export function filterLawyerProfiles(profiles: BranchProfileRow[]): BranchProfileRow[] {
  return profiles.filter(p => isLawyerRole(p.role) && isProfileActive(p))
}

export async function fetchBranchProfiles(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<{ profiles: BranchProfileRow[]; error: unknown | null }> {
  if (!branchId) return { profiles: [], error: null }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, branch_id, is_active')
    .eq('branch_id', branchId)
    .order('full_name')

  return { profiles: (data ?? []) as BranchProfileRow[], error: error ?? null }
}

export function toLawyerOptions(profiles: BranchProfileRow[]): { id: string; full_name: string }[] {
  return filterLawyerProfiles(profiles).map(({ id, full_name }) => ({ id, full_name }))
}
