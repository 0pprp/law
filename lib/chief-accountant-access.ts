import type { SupabaseClient } from '@supabase/supabase-js'
import { isChiefAccountant } from '@/lib/permissions'
import { canStaffReadBranch, canStaffWriteBranch, type BranchAccessProfile } from '@/lib/staff-branch-access'
import { apiForbiddenResponse } from '@/lib/permissions'
import { NextResponse } from 'next/server'

export type DebtorAccessRow = {
  id: string
  branch_id: string | null
  assigned_chief_accountant_id?: string | null
  file_preparation_status?: string | null
  full_name?: string | null
  case_type?: string | null
  current_task_id?: string | null
}

export function isAssignedToChief(
  userId: string,
  debtor: Pick<DebtorAccessRow, 'assigned_chief_accountant_id'>,
): boolean {
  return Boolean(debtor.assigned_chief_accountant_id && debtor.assigned_chief_accountant_id === userId)
}

/** قراءة: فرع مسموح أو مدين معيَّن للمحاسب الرئيسي */
export function canStaffOrChiefReadDebtor(
  profile: (BranchAccessProfile & { id?: string }) | null | undefined,
  debtor: Pick<DebtorAccessRow, 'branch_id' | 'assigned_chief_accountant_id'>,
): boolean {
  if (!profile?.role) return false
  if (canStaffReadBranch(profile, debtor.branch_id)) return true
  if (isChiefAccountant(profile.role) && profile.id && isAssignedToChief(profile.id, debtor)) return true
  return false
}

/** كتابة: فرع مسموح أو مدين معيَّن للمحاسب الرئيسي */
export function canStaffOrChiefWriteDebtor(
  profile: (BranchAccessProfile & { id?: string }) | null | undefined,
  debtor: Pick<DebtorAccessRow, 'branch_id' | 'assigned_chief_accountant_id'>,
): boolean {
  if (!profile?.role) return false
  if (canStaffWriteBranch(profile, debtor.branch_id)) return true
  if (isChiefAccountant(profile.role) && profile.id && isAssignedToChief(profile.id, debtor)) return true
  return false
}

export async function fetchDebtorForChiefAccess(
  admin: SupabaseClient,
  debtorId: string,
): Promise<DebtorAccessRow | null> {
  const { data } = await admin
    .from('debtors')
    .select('id, branch_id, assigned_chief_accountant_id, file_preparation_status, full_name, case_type, current_task_id')
    .eq('id', debtorId)
    .maybeSingle()
  return (data as DebtorAccessRow | null) ?? null
}

/** يفرض أن المستخدم محاسب رئيسي والدين معيَّن له */
export async function requireAssignedChiefDebtor(
  admin: SupabaseClient,
  userId: string,
  role: string | null | undefined,
  debtorId: string,
): Promise<{ ok: true; debtor: DebtorAccessRow } | { ok: false; error: Response }> {
  if (!isChiefAccountant(role)) {
    return { ok: false, error: apiForbiddenResponse() }
  }
  const debtor = await fetchDebtorForChiefAccess(admin, debtorId)
  if (!debtor) {
    return { ok: false, error: NextResponse.json({ error: 'المدين غير موجود' }, { status: 404 }) }
  }
  if (!isAssignedToChief(userId, debtor)) {
    return { ok: false, error: apiForbiddenResponse() }
  }
  return { ok: true, debtor }
}
