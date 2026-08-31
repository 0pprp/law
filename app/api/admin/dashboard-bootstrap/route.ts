import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { filterBySection } from '@/lib/case-scope'
import { canStaffReadBranch } from '@/lib/staff-branch-access'
import { canUseViewAllBranchesFilter, canViewInstantCases, isAdmin } from '@/lib/permissions'
import { fetchDashboardBootstrap } from '@/lib/dashboard-bootstrap'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error

    const { searchParams } = request.nextUrl
    const viewAll = searchParams.get('viewAll') === '1'
    const requestedBranch = searchParams.get('branchId')?.trim() || null
    const branchId = viewAll ? null : requestedBranch

    if (viewAll) {
      if (!canUseViewAllBranchesFilter(auth.profile?.role, auth.profile?.accountant_type)) {
        return NextResponse.json({ error: 'لا صلاحية على كل الفروع' }, { status: 403 })
      }
    } else if (!branchId) {
      return NextResponse.json({ error: 'معرّف الفرع مطلوب' }, { status: 400 })
    } else if (!canStaffReadBranch(auth.profile, branchId)) {
      return NextResponse.json({ error: 'لا صلاحية على هذا الفرع' }, { status: 403 })
    }

    const rawCase = searchParams.get('caseType')
    const scopeCase = filterBySection(sessionCaseScope(auth.profile))
    const caseType =
      rawCase === 'civil' || rawCase === 'criminal'
        ? rawCase
        : scopeCase

    if (scopeCase && caseType && scopeCase !== caseType) {
      return NextResponse.json({
        ok: true,
        civil: { stages: [], assignedStages: [], overdueStages: [], unassigned: 0, assigned: 0 },
        criminal: { stages: [], assignedStages: [], overdueStages: [], unassigned: 0, assigned: 0 },
        ops: { awaiting: 0, prep: 0, receiptsPrep: 0, instant: 0, recentNames: 0, legalArchive: 0 },
        pendingReview: 0,
        recentActivity: [],
        pleadingHearingBadges: { yellow: 0, red: 0, gray: 0 },
      })
    }

    const branchListId = searchParams.get('branchListId')?.trim() || null
    const includeCivil = caseType !== 'criminal'
    const includeCriminal = caseType !== 'civil'
    const role = auth.profile?.role
    const admin = createAdminClient()

    const data = await fetchDashboardBootstrap(admin, {
      branchId,
      branchListId: caseType === 'criminal' ? null : branchListId,
      caseType: caseType ?? null,
      includeCivil,
      includeCriminal,
      includeOps: true,
      includeInstant: canViewInstantCases(role) && caseType !== 'criminal',
      includeHearingBadges: includeCivil && (isAdmin(role) || role === 'viewer'),
    })

    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    console.error('[admin/dashboard-bootstrap]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
