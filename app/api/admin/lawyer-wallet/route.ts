import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  canAccessFinance,
  apiForbiddenResponse,
  isAccountant,
  isGeneralAccountant,
} from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'
import { getBranchContext } from '@/lib/branch-context'
import {
  fetchLawyerWalletBalances,
  fetchLawyerWalletTransactions,
  fetchLawyerBalancesMap,
  fetchLawyerSavingsBalancesMap,
} from '@/lib/lawyer-wallet'
import { resolveCaseScope, filterBySection } from '@/lib/case-scope'

/** Admin finance — service-role wallet reads only. */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const profile = await fetchStaffRoleFields(supabase, user.id)
    if (!profile || !canAccessFinance(profile.role)) {
      return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
    }

    const lawyerId = request.nextUrl.searchParams.get('lawyerId')
    const admin = createAdminClient()
    const scope = resolveCaseScope(profile.role)
    const lockedCaseType = filterBySection(scope)

    const branchScoped = (isAccountant(profile.role) && !isGeneralAccountant(profile.role, profile.accountant_type))
      || profile.role === 'employee'

    if (lawyerId) {
      if (branchScoped) {
        if (!profile.branch_id) return apiForbiddenResponse()
        const { data: lawyer } = await admin
          .from('profiles')
          .select('id, branch_id, role, case_type')
          .eq('id', lawyerId)
          .maybeSingle()
        if (!lawyer || lawyer.branch_id !== profile.branch_id) {
          return apiForbiddenResponse()
        }
        if (lockedCaseType && lawyer.case_type !== lockedCaseType) {
          return apiForbiddenResponse()
        }
      } else if (lockedCaseType) {
        const { data: lawyer } = await admin
          .from('profiles')
          .select('id, case_type')
          .eq('id', lawyerId)
          .maybeSingle()
        if (!lawyer || lawyer.case_type !== lockedCaseType) {
          return apiForbiddenResponse()
        }
      }

      const viewerOpts = { viewerRole: profile.role }
      const [balances, txs] = await Promise.all([
        fetchLawyerWalletBalances(admin, lawyerId, viewerOpts),
        fetchLawyerWalletTransactions(admin, lawyerId, 100, undefined, viewerOpts),
      ])
      return NextResponse.json({ balances, txs })
    }

    const caseTypeParam = request.nextUrl.searchParams.get('caseType')?.trim() || ''
    const effectiveCaseType =
      lockedCaseType
      ?? (caseTypeParam === 'civil' || caseTypeParam === 'criminal' ? caseTypeParam : null)

    const { branchId } = await getBranchContext()
    let q = admin
      .from('profiles')
      .select('id, full_name, username, phone, branch_id, case_type')
      .eq('role', 'lawyer')
      .eq('is_active', true)
    const effectiveBranch = branchScoped ? profile.branch_id : branchId
    if (effectiveBranch) q = q.eq('branch_id', effectiveBranch)
    if (effectiveCaseType) q = q.eq('case_type', effectiveCaseType)
    const { data: lawyers } = await q.order('full_name')
    const ids = (lawyers ?? []).map(l => l.id)

    const viewerOpts = { viewerRole: profile.role }
    const [feesMap, savingsMap] = await Promise.all([
      fetchLawyerBalancesMap(admin, ids, viewerOpts),
      fetchLawyerSavingsBalancesMap(admin, ids),
    ])

    const balances: Record<string, { fees: number; savings: number }> = {}
    for (const id of ids) {
      balances[id] = {
        fees: feesMap.get(id) ?? 0,
        savings: savingsMap.get(id) ?? 0,
      }
    }

    // الملفات تُقرأ عبر service role بعد التحقق من الدور والنطاق أعلاه؛
    // هذا يصلح إخفاء RLS لمحامي الفروع عن المحاسب العام.
    return NextResponse.json({ balances, lawyers: lawyers ?? [] })
  } catch (e) {
    console.error('[admin/lawyer-wallet GET]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
