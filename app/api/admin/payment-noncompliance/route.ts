import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import {
  apiForbiddenResponse,
  canReviewPaymentNoncomplianceRequest,
  canSubmitPaymentNoncomplianceRequest,
} from '@/lib/permissions'
import { CASE_STATUS_PAYMENT_IN_PROGRESS } from '@/lib/types'
import { logActivity } from '@/lib/activity-log'
import { fetchPendingNoncomplianceRequests } from '@/lib/payment-noncompliance'
import { filterBySection } from '@/lib/case-scope'
import { requireDebtorInScope } from '@/lib/section-guard'

/** قائمة الطلبات المعلقة — مدير / مسؤول القانونية */
export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canReviewPaymentNoncomplianceRequest(auth.profile?.role)) {
    return apiForbiddenResponse()
  }

  const { searchParams } = new URL(request.url)
  const branchId = searchParams.get('branchId')?.trim() || null
  const viewAll = searchParams.get('viewAll') === '1'
  const listId = searchParams.get('listId')?.trim() || null
  const offset = Number(searchParams.get('offset') ?? 0) || 0
  const limit = Number(searchParams.get('limit') ?? 50) || 50

  const scope = sessionCaseScope(auth.profile)
  const lockedCaseType = filterBySection(scope)
  const caseTypeParam = searchParams.get('caseType')?.trim() || ''
  const caseType =
    lockedCaseType
    ?? (caseTypeParam === 'civil' || caseTypeParam === 'criminal' ? caseTypeParam : null)

  const admin = createAdminClient()
  const res = await fetchPendingNoncomplianceRequests(
    admin,
    viewAll ? null : branchId,
    { offset, limit, branchListId: viewAll ? null : listId, caseType },
  )
  if (res.error) {
    return NextResponse.json({ error: res.error }, { status: 500 })
  }
  return NextResponse.json({ rows: res.rows, total: res.total })
}

/** إنشاء طلب عدم التزام — مسؤول متابعة التسديد فقط */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canSubmitPaymentNoncomplianceRequest(auth.profile?.role) || !auth.profile) {
    return apiForbiddenResponse()
  }

  let body: { debtorId?: string; note?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const debtorId = String(body.debtorId ?? '').trim()
  const note = String(body.note ?? '').trim() || null
  if (!debtorId) {
    return NextResponse.json({ error: 'معرّف المدين مطلوب' }, { status: 400 })
  }

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(
    admin,
    scope,
    debtorId,
    'id, full_name, case_status, branch_id, last_task_id, case_type',
  )
  if (!gate.ok) return gate.error

  const debtor = gate.data as {
    id: string
    full_name: string | null
    case_status: string | null
    branch_id: string | null
    last_task_id: string | null
  }

  if (debtor.case_status !== CASE_STATUS_PAYMENT_IN_PROGRESS) {
    return NextResponse.json({ error: 'المدين ليس في جاري التسديد' }, { status: 400 })
  }

  const { data: existing } = await admin
    .from('payment_noncompliance_requests')
    .select('id')
    .eq('debtor_id', debtorId)
    .eq('status', 'pending')
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'يوجد طلب عدم التزام معلّق لهذا المدين مسبقاً' }, { status: 409 })
  }

  const { data: created, error: insErr } = await admin
    .from('payment_noncompliance_requests')
    .insert({
      debtor_id: debtor.id,
      branch_id: debtor.branch_id,
      source_task_id: debtor.last_task_id,
      requested_by: auth.profile.id,
      note,
      status: 'pending',
    })
    .select('id')
    .single()

  if (insErr || !created) {
    if (insErr?.code === '23505') {
      return NextResponse.json({ error: 'يوجد طلب عدم التزام معلّق لهذا المدين مسبقاً' }, { status: 409 })
    }
    if (insErr?.message?.includes('payment_noncompliance_requests') || insErr?.code === '42P01') {
      return NextResponse.json({
        error: 'جدول طلبات عدم الالتزام غير مفعّل — شغّل supabase/scripts/apply-payment-noncompliance-requests.sql',
      }, { status: 500 })
    }
    console.error('[payment-noncompliance:create]', insErr?.message)
    return NextResponse.json({ error: 'فشل إرسال الطلب' }, { status: 500 })
  }

  await logActivity({
    action: 'submit_payment_noncompliance_request',
    entity_type: 'debtor',
    entity_id: debtor.id,
    description: `طلب عدم التزام: ${debtor.full_name ?? ''}${note ? ` — ${note}` : ''}`,
    case_type: gate.caseType,
  }, auth.supabase)

  return NextResponse.json({ ok: true, id: created.id })
}
