import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { canReadAllBranches, canUseViewAllBranchesFilter, isGeneralAccountant } from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'

export const BRANCH_COOKIE = 'qalat_branch'
/** قيمة خاصة في الكوكي تعني فلتر واجهة «كل الفروع» — ليست فرعاً في قاعدة البيانات */
export const BRANCH_COOKIE_ALL = '__all__'

export interface BranchContext {
  branchId: string | null
  isAdmin: boolean
  /** true عند اختيار «الكل» (مدير / محاسب عام) — فلتر واجهة فقط */
  viewAllBranches: boolean
}

export async function getBranchContext(): Promise<BranchContext> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { branchId: null, isAdmin: false, viewAllBranches: false }

  const profile = await fetchStaffRoleFields(supabase, user.id)
  if (!profile) return { branchId: null, isAdmin: false, viewAllBranches: false }

  const isBranchPicker = canReadAllBranches(profile.role, profile.accountant_type)
  const allowViewAll = canUseViewAllBranchesFilter(profile.role, profile.accountant_type)
  /** المحاسب العام فقط: بدون كوكي → افتراض «الكل». المدير يبقى بانتظار اختيار صريح. */
  const defaultToAll = isGeneralAccountant(profile.role, profile.accountant_type)

  if (isBranchPicker) {
    const cookieStore = await cookies()
    const raw = cookieStore.get(BRANCH_COOKIE)?.value ?? null
    if (raw === BRANCH_COOKIE_ALL) {
      if (allowViewAll) {
        return { branchId: null, isAdmin: true, viewAllBranches: true }
      }
      // كوكي «الكل» بدون صلاحية — تجاهلها وانتظر اختيار فرع
      return { branchId: null, isAdmin: true, viewAllBranches: false }
    }
    if (defaultToAll && !raw) {
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
