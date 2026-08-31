import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { filterBySection } from '@/lib/case-scope'
import { apiForbiddenResponse, canAssignTasks, isAdmin, isAnyLegalManager } from '@/lib/permissions'
import { fetchReceiptsPrep, setReceiptsPrepared, type ReceiptsPrepRow } from '@/lib/receipts-prep'
import { canStaffReadBranch } from '@/lib/staff-branch-access'
import { requireDebtorInScope } from '@/lib/section-guard'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'

function canViewReceiptsPrep(role: string | null | undefined): boolean {
  return isAdmin(role) || isAnyLegalManager(role) || canAssignTasks(role)
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error
    if (!canViewReceiptsPrep(auth.profile?.role)) return apiForbiddenResponse()

    const { searchParams } = request.nextUrl
    const viewAll = searchParams.get('viewAll') === '1'
    const requestedBranch = searchParams.get('branchId')
    const branchId = viewAll ? null : (requestedBranch?.trim() || null)
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
      return NextResponse.json({ ok: true, rows: [], total: 0, columnMissing: false })
    }

    const listId = searchParams.get('listId')?.trim() || null
    const countOnly = searchParams.get('countOnly') === '1'
    const admin = createAdminClient()

    const run = (ct: 'civil' | 'criminal' | null, branchListId: string | null) =>
      fetchReceiptsPrep(admin, {
        branchId,
        branchListId,
        caseType: ct,
        countOnly,
      })

    if (!caseType && listId) {
      const [civil, criminal] = await Promise.all([
        run('civil', listId),
        run('criminal', null),
      ])
      const rows: ReceiptsPrepRow[] = countOnly
        ? []
        : [...civil.rows, ...criminal.rows].sort((a, b) =>
            a.debtorName.localeCompare(b.debtorName, 'ar'),
          )
      return NextResponse.json({
        ok: true,
        rows,
        total: civil.total + criminal.total,
        columnMissing: civil.columnMissing || criminal.columnMissing,
      })
    }

    const result = await run(caseType, caseType === 'criminal' ? null : listId)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[admin/receipts-prep]', e)
    const message = e instanceof Error ? e.message : 'حدث خطأ غير متوقع'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canViewReceiptsPrep(auth.profile?.role)) return apiForbiddenResponse()

  let body: { debtorId?: unknown; prepared?: unknown }
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const debtorId = String(body.debtorId ?? '').trim()
  if (!debtorId) return safeClientError('معرّف المدين مطلوب', 400)
  const prepared = body.prepared !== false && body.prepared !== 'false'

  const admin = createAdminClient()
  const gate = await requireDebtorInScope(
    admin,
    sessionCaseScope(auth.profile),
    debtorId,
    'id, full_name, case_type, branch_id',
  )
  if (!gate.ok) return gate.error

  const debtor = gate.data as { id: string; full_name: string | null; case_type?: string | null; branch_id?: string | null }
  if (debtor.branch_id && !canStaffReadBranch(auth.profile, debtor.branch_id)) {
    return apiForbiddenResponse()
  }

  const result = await setReceiptsPrepared(admin, {
    debtorId,
    prepared,
    actorId: auth.user!.id,
  })
  if (!result.ok) {
    return apiServerError('receipts-prep:mark', result.error, result.error, result.status)
  }

  if (result.noteWritten) {
    await logActivity({
      action: 'receipts_prepared',
      entity_type: 'debtor',
      entity_id: debtorId,
      description: `تم تجهيز الوصل — ${debtor.full_name ?? debtorId}`,
      case_type: debtor.case_type === 'criminal' ? 'criminal' : 'civil',
    }, auth.supabase)
  }

  return NextResponse.json({
    ok: true,
    receiptsPrepared: result.receiptsPrepared,
    noteWritten: result.noteWritten,
  })
}
