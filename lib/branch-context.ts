import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { canReadAllBranches, isGeneralAccountant } from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'

export const BRANCH_COOKIE = 'qalat_branch'
/** قيمة خاصة تعني «كل الفروع» للمحاسب العام */
export const BRANCH_COOKIE_ALL = '__all__'

export interface BranchContext {
  branchId: string | null
  isAdmin: boolean
  /** true عندما يختار المحاسب العام «الكل» */
  viewAllBranches: boolean
}

export async function getBranchContext(): Promise<BranchContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { branchId: null, isAdmin: false, viewAllBranches: false }

  const profile = await fetchStaffRoleFields(supabase, user.id)
  if (!profile) return { branchId: null, isAdmin: false, viewAllBranches: false }

  const isBranchPicker = canReadAllBranches(profile.role, profile.accountant_type)
  const allowViewAll = isGeneralAccountant(profile.role, profile.accountant_type)

  if (isBranchPicker) {
    const cookieStore = await cookies()
    const raw = cookieStore.get(BRANCH_COOKIE)?.value ?? null
    if (raw === BRANCH_COOKIE_ALL || (allowViewAll && !raw)) {
      return { branchId: null, isAdmin: true, viewAllBranches: true }
    }
    if (raw) {
      return { branchId: raw, isAdmin: true, viewAllBranches: false }
    }
    // مدير / مسؤول قانونية بدون كوكي — انتظار اختيار فرع (ليس «الكل»)
    return { branchId: null, isAdmin: true, viewAllBranches: false }
  }

  return {
    branchId: profile.branch_id ?? null,
    isAdmin: false,
    viewAllBranches: false,
  }
}

export async function getActiveBranchId(): Promise<string | null> {
  const ctx = await getBranchContext()
  return ctx.branchId
}
