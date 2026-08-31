import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { filterBySection } from '@/lib/case-scope'
import { fetchStageDebtors, type StageView } from '@/lib/stage-debtors'
import { canStaffReadBranch } from '@/lib/staff-branch-access'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error

    const { searchParams } = request.nextUrl
    const stageId = String(searchParams.get('stageId') ?? '').trim()
    if (!stageId) {
      return NextResponse.json({ error: 'معرّف المرحلة مطلوب' }, { status: 400 })
    }

    const rawView = searchParams.get('view')
    const view: StageView =
      rawView === 'assigned' || rawView === 'overdue' ? rawView : 'waiting'

    const requestedBranch = searchParams.get('branchId')
    const branchId = requestedBranch?.trim() || null
    if (branchId && !canStaffReadBranch(auth.profile, branchId)) {
      return NextResponse.json({ error: 'لا صلاحية على هذا الفرع' }, { status: 403 })
    }

    const offset = Math.max(0, Number(searchParams.get('offset') ?? 0) || 0)
    const limit = Math.min(400, Math.max(1, Number(searchParams.get('limit') ?? 200) || 200))
    const search = searchParams.get('search') ?? ''
    const scopeCase = filterBySection(sessionCaseScope(auth.profile))

    const admin = createAdminClient()
    const result = await fetchStageDebtors(admin, {
      stageId,
      view,
      branchId,
      offset,
      limit,
      search,
      caseType: scopeCase,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[admin/stage-debtors]', e)
    const message = e instanceof Error ? e.message : 'حدث خطأ غير متوقع'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
