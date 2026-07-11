import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountantType } from '@/lib/accountant-type'
import { normalizeAccountantType } from '@/lib/accountant-type'

export interface StaffProfileRow {
  full_name?: string | null
  role: string | null
  branch_id?: string | null
  accountant_type?: AccountantType | null
  is_active?: boolean | null
}

function isMissingAccountantTypeColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error?.message) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes('accountant_type') ||
    (msg.includes('column') && msg.includes('does not exist'))
  )
}

/**
 * تحميل ملف الموظف بأمان.
 * إذا لم يُطبَّق عمود accountant_type بعد، لا نكسر الدور/الصلاحيات.
 */
export async function fetchStaffProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<StaffProfileRow | null> {
  const withType = await supabase
    .from('profiles')
    .select('full_name, role, branch_id, accountant_type, is_active')
    .eq('id', userId)
    .single()

  if (!withType.error && withType.data) {
    return {
      ...withType.data,
      accountant_type: normalizeAccountantType(withType.data.accountant_type),
    }
  }

  if (!isMissingAccountantTypeColumn(withType.error)) {
    console.error('[fetchStaffProfile]', withType.error?.message ?? withType.error)
    // ما زلنا نحاول بدون العمود إذا فشل الاستعلام لأي سبب مشابه
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
