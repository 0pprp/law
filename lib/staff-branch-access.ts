import {
  canReadAllBranches,
  isAccountant,
  isAdmin,
  isLegalManager,
} from '@/lib/permissions'
import type { AccountantType } from '@/lib/accountant-type'

export type BranchAccessProfile = {
  role: string | null
  branch_id?: string | null
  accountant_type?: AccountantType | string | null
}

/** قراءة بيانات فرع (مدينون/إعدادات للعرض) */
export function canStaffReadBranch(
  profile: BranchAccessProfile | null | undefined,
  targetBranchId: string | null | undefined,
): boolean {
  if (!profile?.role || !targetBranchId) return false
  if (isAdmin(profile.role) || profile.role === 'employee' || isLegalManager(profile.role)) return true
  if (canReadAllBranches(profile.role, profile.accountant_type)) return true
  if (isAccountant(profile.role)) return profile.branch_id === targetBranchId
  return false
}

/** كتابة بيانات فرع (إضافة مدين / إعدادات) */
export function canStaffWriteBranch(
  profile: BranchAccessProfile | null | undefined,
  targetBranchId: string | null | undefined,
): boolean {
  if (!profile?.role || !targetBranchId) return false
  if (isLegalManager(profile.role)) return false
  if (isAdmin(profile.role) || profile.role === 'employee') return true
  if (canReadAllBranches(profile.role, profile.accountant_type)) return true
  if (isAccountant(profile.role)) return profile.branch_id === targetBranchId
  return false
}
