import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { filterBySection } from '@/lib/case-scope'
import { fetchDashboardData } from '@/lib/task-assignment'
import { canStaffReadBranch } from '@/lib/staff-branch-access'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error

    const { searchParams } = request.nextUrl
    const requestedBranch = searchParams.get('branchId')
    const branchId = requestedBranch?.trim() || null
    if (branchId && !canStaffReadBranch(auth.profile, branchId)) {
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
        stages: [],
        assignedStages: [],
        overdueStages: [],
        unassigned: 0,
        assigned: 0,
      })
    }

    const branchListId = searchParams.get('branchListId')?.trim() || null
    const admin = createAdminClient()
    const data = await fetchDashboardData(admin, branchId, {
      caseType: caseType ?? null,
      branchListId: caseType === 'criminal' ? null : branchListId,
    })

    return NextResponse.json({ ok: true, ...data })
  } catch (e) {
    console.error('[admin/dashboard-stages]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
