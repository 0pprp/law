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
}

function isMissingOptionalColumn(error: { message?: string; code?: string } | null, col: string): boolean {
  if (!error?.message) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes(col) ||
    (msg.includes('column') && msg.includes('does not exist'))
  )
}

/**
 * تحميل ملف الموظف بأمان.
 * إذا لم يُطبَّق عمود accountant_type / case_type بعد، لا نكسر الدور/الصلاحيات.
 */
export async function fetchStaffProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<StaffProfileRow | null> {
  const withAll = await supabase
    .from('profiles')
    .select('full_name, role, branch_id, accountant_type, case_type, is_active')
    .eq('id', userId)
    .single()

  if (!withAll.error && withAll.data) {
    const ct = withAll.data.case_type
    return {
      ...withAll.data,
      accountant_type: normalizeAccountantType(withAll.data.accountant_type),
      case_type: ct === 'civil' || ct === 'criminal' ? ct : 'civil',
    }
  }

  const missingCaseType = isMissingOptionalColumn(withAll.error, 'case_type')
  const missingAccountant = isMissingOptionalColumn(withAll.error, 'accountant_type')

  if (!missingCaseType && !missingAccountant) {
    console.error('[fetchStaffProfile]', withAll.error?.message ?? withAll.error)
  }

  const withAccountant = await supabase
    .from('profiles')
    .select('full_name, role, branch_id, accountant_type, is_active')
    .eq('id', userId)
    .single()

  if (!withAccountant.error && withAccountant.data) {
    return {
      ...withAccountant.data,
      accountant_type: normalizeAccountantType(withAccountant.data.accountant_type),
      case_type: 'civil',
    }
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

  return {
    ...fallback.data,
    accountant_type: 'branch',
    case_type: 'civil',
  }
}

export async function fetchStaffRoleFields(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ role: string | null; branch_id?: string | null; accountant_type: AccountantType } | null> {
  const profile = await fetchStaffProfile(supabase, userId)
  if (!profile) return null
  return {
    role: profile.role,
    branch_id: profile.branch_id ?? null,
    accountant_type: normalizeAccountantType(profile.accountant_type),
  }
}
