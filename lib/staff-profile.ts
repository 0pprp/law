import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountantType } from '@/lib/accountant-type'
import { normalizeAccountantType } from '@/lib/accountant-type'

export interface StaffProfileRow {
  full_name?: string | null
  role: string | null
  branch_id?: string | null
  accountant_type?: AccountantType | null
  case_type?: 'civil' | 'criminal' | null
  is_active?: boolean | null
  can_access_civil?: boolean | null
  can_access_criminal?: boolean | null
}

function isMissingOptionalColumn(error: { message?: string; code?: string } | null, col: string): boolean {
  if (!error?.message) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes(col.toLowerCase()) ||
    (msg.includes('column') && msg.includes('does not exist'))
  )
}

function normalizeBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  return fallback
}

function withSectionDefaults(row: StaffProfileRow): StaffProfileRow {
  const role = row.role
  const civilDefault = role === 'criminal_legal_manager' ? false : true
  const criminalDefault = role === 'criminal_legal_manager' ? true : false
  return {
    ...row,
    can_access_civil: normalizeBool(row.can_access_civil, civilDefault),
    can_access_criminal: normalizeBool(row.can_access_criminal, criminalDefault),
  }
}

/**
 * تحميل ملف الموظف بأمان.
 * إذا لم يُطبَّق عمود accountant_type / case_type / can_access_* بعد، لا نكسر الدور/الصلاحيات.
 */
export async function fetchStaffProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<StaffProfileRow | null> {
  const withAll = await supabase
    .from('profiles')
    .select('full_name, role, branch_id, accountant_type, case_type, is_active, can_access_civil, can_access_criminal')
    .eq('id', userId)
    .single()

  if (!withAll.error && withAll.data) {
    const ct = withAll.data.case_type
    return withSectionDefaults({
      ...withAll.data,
      accountant_type: normalizeAccountantType(withAll.data.accountant_type),
      case_type: ct === 'civil' || ct === 'criminal' ? ct : 'civil',
    })
  }

  const missingSection =
    isMissingOptionalColumn(withAll.error, 'can_access_civil')
    || isMissingOptionalColumn(withAll.error, 'can_access_criminal')
  const missingCaseType = isMissingOptionalColumn(withAll.error, 'case_type')
  const missingAccountant = isMissingOptionalColumn(withAll.error, 'accountant_type')

  if (!missingSection && !missingCaseType && !missingAccountant) {
    console.error('[fetchStaffProfile]', withAll.error?.message ?? withAll.error)
  }

  if (missingSection && !missingCaseType && !missingAccountant) {
    const withoutSection = await supabase
      .from('profiles')
      .select('full_name, role, branch_id, accountant_type, case_type, is_active')
      .eq('id', userId)
      .single()
    if (!withoutSection.error && withoutSection.data) {
      const ct = withoutSection.data.case_type
      return withSectionDefaults({
        ...withoutSection.data,
        accountant_type: normalizeAccountantType(withoutSection.data.accountant_type),
        case_type: ct === 'civil' || ct === 'criminal' ? ct : 'civil',
      })
    }
  }

  const withAccountant = await supabase
    .from('profiles')
    .select('full_name, role, branch_id, accountant_type, is_active')
    .eq('id', userId)
    .single()

  if (!withAccountant.error && withAccountant.data) {
    return withSectionDefaults({
      ...withAccountant.data,
      accountant_type: normalizeAccountantType(withAccountant.data.accountant_type),
      case_type: 'civil',
    })
  }

  const fallback = await supabase
    .from('profiles')
    .select('full_name, role, branch_id, is_active')
    .eq('id', userId)
    .single()

  if (fallback.error || !fallback.data) {
    console.error('[fetchStaffProfile:fallback]', fallback.error?.message ?? fallback.error)
    return null
  }

  return withSectionDefaults({
    ...fallback.data,
    accountant_type: 'branch',
    case_type: 'civil',
  })
}

export async function fetchStaffRoleFields(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  role: string | null
  branch_id?: string | null
  accountant_type: AccountantType
  can_access_civil?: boolean
  can_access_criminal?: boolean
} | null> {
  const profile = await fetchStaffProfile(supabase, userId)
  if (!profile) return null
  return {
    role: profile.role,
    branch_id: profile.branch_id ?? null,
    accountant_type: normalizeAccountantType(profile.accountant_type),
    can_access_civil: profile.can_access_civil ?? true,
    can_access_criminal: profile.can_access_criminal ?? false,
  }
}
