import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { canViewInstantCases, canUseViewAllBranchesFilter } from '@/lib/permissions'
import { apiForbiddenResponse } from '@/lib/permissions'
import { canStaffReadBranch } from '@/lib/staff-branch-access'
import { filterBySection } from '@/lib/case-scope'

/** قائمة الدعاوى الفورية للمدير (معلّق + معتمد) */
export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canViewInstantCases(auth.profile?.role)) return apiForbiddenResponse()

  const { searchParams } = new URL(request.url)
  const branchId = searchParams.get('branchId')?.trim() || null
  const viewAll = searchParams.get('viewAll') === '1'
  const listId = searchParams.get('listId')?.trim() || ''
  const status = searchParams.get('status')?.trim() || ''
  const search = searchParams.get('q')?.trim() || ''
  const countOnly = searchParams.get('countOnly') === '1'

  if (viewAll) {
    if (!canUseViewAllBranchesFilter(auth.profile?.role, auth.profile?.accountant_type)) {
      return apiForbiddenResponse()
    }
  } else if (!branchId) {
    return NextResponse.json({ error: 'معرّف الفرع مطلوب' }, { status: 400 })
  } else if (!canStaffReadBranch(auth.profile, branchId)) {
    return apiForbiddenResponse()
  }

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  // الدعاوى الفورية مدنية دائماً — أخفِ عند نطاق جزائي قسري
  if (filterBySection(scope) === 'criminal') {
    return NextResponse.json(countOnly ? { total: 0 } : { nominations: [], total: 0 })
  }

  if (countOnly) {
    let cq = admin
      .from('instant_case_nominations')
      .select('id', { count: 'exact', head: true })
    if (!viewAll && branchId) cq = cq.eq('branch_id', branchId)
    if (listId) cq = cq.eq('branch_list_id', listId)
    if (status === 'pending' || status === 'approved') cq = cq.eq('status', status)
    const { count, error } = await cq
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ total: count ?? 0 })
  }

  let q = admin
    .from('instant_case_nominations')
    .select(`
      id, debtor_name, sale_price, governorate, status, created_at, reviewed_at,
      debtor_id, branch_id, branch_list_id, nominator_role,
      branch:branches(id, name),
      branch_list:branch_lists(id, name),
      nominator:profiles!instant_case_nominations_nominated_by_fkey(id, full_name),
      debtor:debtors!instant_case_nominations_debtor_id_fkey(id, file_preparation_status)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(500)

  if (!viewAll && branchId) q = q.eq('branch_id', branchId)
  if (listId) q = q.eq('branch_list_id', listId)
  if (status === 'pending' || status === 'approved') q = q.eq('status', status)
  if (search) {
    const s = search.replace(/[%_,]/g, '')
    q = q.ilike('debtor_name', `%${s}%`)
  }

  const { data, count, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ nominations: data ?? [], total: count ?? 0 })
}
