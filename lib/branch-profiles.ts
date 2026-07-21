import type { SupabaseClient } from '@supabase/supabase-js'
import { isGeneralLawyerType } from '@/lib/lawyer-type'

/** Same query base as /admin/lawyers (users page): profiles in branch, no role filter in SQL. */
export interface BranchProfileRow {
  id: string
  full_name: string
  role: string | null
  branch_id: string | null
  lawyer_type?: string | null
  case_type?: string | null
  is_active?: boolean | null
  active?: boolean | null
  status?: string | null
}

export interface LawyerOption {
  id: string
  full_name: string
  lawyer_type?: string | null
  is_general?: boolean
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

export function filterNormalLawyerProfiles(profiles: BranchProfileRow[]): BranchProfileRow[] {
  return filterLawyerProfiles(profiles).filter(p => !isGeneralLawyerType(p.lawyer_type))
}

export function filterGeneralLawyerProfiles(profiles: BranchProfileRow[]): BranchProfileRow[] {
  return filterLawyerProfiles(profiles).filter(p => isGeneralLawyerType(p.lawyer_type))
}

export async function fetchBranchProfiles(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: { caseType?: 'civil' | 'criminal' | null },
): Promise<{ profiles: BranchProfileRow[]; error: unknown | null }> {
  if (!branchId) return { profiles: [], error: null }

  let q = supabase
    .from('profiles')
    .select('id, full_name, role, branch_id, lawyer_type, case_type, is_active')
    .eq('branch_id', branchId)
    .order('full_name')

  // فلتر قسم المحامين فقط — الأدوار الأخرى تبقى ظاهرة للإدارة عند both
  const { data, error } = await q
  let profiles = (data ?? []) as BranchProfileRow[]
  const ct = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null
  if (ct) {
    profiles = profiles.filter(p => {
      if (!isLawyerRole(p.role)) return true
      const pct = (p as { case_type?: string }).case_type === 'criminal' ? 'criminal' : 'civil'
      return pct === ct
    })
  }

  return { profiles, error: error ?? null }
}

export async function fetchGeneralLawyers(
  supabase: SupabaseClient,
  options?: { caseType?: 'civil' | 'criminal' | null },
): Promise<{ profiles: BranchProfileRow[]; error: unknown | null }> {
  let q = supabase
    .from('profiles')
    .select('id, full_name, role, branch_id, lawyer_type, case_type, is_active')
    .eq('role', 'lawyer')
    .eq('lawyer_type', 'general')
    .eq('is_active', true)
    .order('full_name')
  if (options?.caseType === 'civil' || options?.caseType === 'criminal') {
    q = q.eq('case_type', options.caseType)
  }
  const { data, error } = await q

  return { profiles: (data ?? []) as BranchProfileRow[], error: error ?? null }
}

/** For task assignment: branch normal lawyers + all general lawyers.
 * When branchId is null (كل الفروع), only general lawyers — assignment across mixed branches needs a selected branch for normal lawyers.
 * options.caseType يفلتر المحامين حسب قسم المدين/النطاق.
 */
export async function fetchAssignmentLawyers(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: { caseType?: 'civil' | 'criminal' | null },
): Promise<{ lawyers: LawyerOption[]; error: unknown | null }> {
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal'
    ? options.caseType
    : null

  if (!branchId) {
    const generalRes = await fetchGeneralLawyers(supabase, { caseType })
    if (generalRes.error) return { lawyers: [], error: generalRes.error }
    const lawyers = filterGeneralLawyerProfiles(generalRes.profiles).map(p => ({
      id: p.id,
      full_name: `${p.full_name} (محامي عام)`,
      lawyer_type: 'general' as const,
      is_general: true,
    }))
    lawyers.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'))
    return { lawyers, error: null }
  }

  const [branchRes, generalRes] = await Promise.all([
    fetchBranchProfiles(supabase, branchId, { caseType }),
    fetchGeneralLawyers(supabase, { caseType }),
  ])

  const error = branchRes.error ?? generalRes.error
  if (error) return { lawyers: [], error }

  const normal = filterNormalLawyerProfiles(branchRes.profiles)
  const general = filterGeneralLawyerProfiles(generalRes.profiles)

  const seen = new Set<string>()
  const lawyers: LawyerOption[] = []

  for (const p of normal) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    lawyers.push({ id: p.id, full_name: p.full_name, lawyer_type: p.lawyer_type ?? 'normal' })
  }

  for (const p of general) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    lawyers.push({
      id: p.id,
      full_name: `${p.full_name} (محامي عام)`,
      lawyer_type: 'general',
      is_general: true,
    })
  }

  lawyers.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'))
  return { lawyers, error: null }
}

export function toLawyerOptions(profiles: BranchProfileRow[]): LawyerOption[] {
  return filterLawyerProfiles(profiles).map(({ id, full_name, lawyer_type }) => ({
    id,
    full_name: isGeneralLawyerType(lawyer_type) ? `${full_name} (محامي عام)` : full_name,
    lawyer_type: lawyer_type ?? 'normal',
    is_general: isGeneralLawyerType(lawyer_type),
  }))
}

export function lawyerOptionLabel(option: LawyerOption): string {
  return option.full_name
}

export interface DelegateOption {
  id: string
  full_name: string
}

export function isDelegateRole(role: string | null | undefined): boolean {
  return role === 'delegate'
}

export function filterDelegateProfiles(profiles: BranchProfileRow[]): BranchProfileRow[] {
  return profiles.filter(p => isDelegateRole(p.role) && isProfileActive(p))
}

/** مندوبو الفرع النشطون — للتكليف على مهام إيجاد عنوان فقط.
 * عند branchId=null تُرجع كل المندوبين النشطين (لتصفية مراجعة الإنجازات).
 * يتحمّل غياب عمود profiles.branch_list_id إن لم تُطبَّق الهجرة بعد.
 */
export async function fetchBranchDelegates(
  supabase: SupabaseClient,
  branchId: string | null,
  branchListId?: string | null,
): Promise<{ delegates: DelegateOption[]; error: unknown | null }> {
  const selectWithList =
    'id, full_name, role, branch_id, branch_list_id, identity_type, identity_number, is_active'
  const selectWithoutList =
    'id, full_name, role, branch_id, identity_type, identity_number, is_active'

  async function run(selectCols: string) {
    let q = supabase
      .from('profiles')
      .select(selectCols)
      .eq('role', 'delegate')
      .order('full_name')

    if (branchId) q = q.eq('branch_id', branchId)
    if (branchListId) {
      q = q.eq('identity_type', 'delegate_list').eq('identity_number', branchListId)
    }
    return q
  }

  let { data, error } = await run(selectWithList)
  if (error && String(error.message ?? '').includes('branch_list_id')) {
    ;({ data, error } = await run(selectWithoutList))
  }
  if (error) return { delegates: [], error }

  const listIds = [...new Set(
    (data ?? [])
      .map(p => (p as { branch_list_id?: string | null; identity_number?: string | null }).branch_list_id
        ?? ((p as { identity_type?: string | null }).identity_type === 'delegate_list'
          ? (p as { identity_number?: string | null }).identity_number
          : null))
      .filter(Boolean),
  )] as string[]

  const listNameMap = new Map<string, string>()
  if (listIds.length) {
    const { data: lists } = await supabase.from('branch_lists').select('id, name').in('id', listIds)
    for (const l of lists ?? []) listNameMap.set(l.id, l.name)
  }

  const delegates = filterDelegateProfiles((data ?? []) as unknown as BranchProfileRow[]).map(p => {
    const row = p as BranchProfileRow & { branch_list_id?: string | null; identity_type?: string | null; identity_number?: string | null }
    const listId = row.branch_list_id ?? (row.identity_type === 'delegate_list' ? row.identity_number : null)
    const listName = listId ? listNameMap.get(listId) : null
    const listSuffix = listName ? ` — ${listName}` : ''
    return {
      id: p.id,
      full_name: `${p.full_name} (مندوب)${listSuffix}`,
    }
  })

  return { delegates, error: null }
}
