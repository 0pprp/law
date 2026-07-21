import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canReviewPaymentNoncomplianceRequest } from '@/lib/permissions'
import { logActivity } from '@/lib/activity-log'
import { requireDebtorInScope } from '@/lib/section-guard'

export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canReviewPaymentNoncomplianceRequest(auth.profile?.role) || !auth.profile) {
    return apiForbiddenResponse()
  }

  let body: { requestId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const requestId = String(body.requestId ?? '').trim()
  if (!requestId) {
    return NextResponse.json({ error: 'معرّف الطلب مطلوب' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: before } = await admin
    .from('payment_noncompliance_requests')
    .select('id, debtor_id, status')
    .eq('id', requestId)
    .maybeSingle()

  if (!before) {
    return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 })
  }
  if (before.status !== 'pending') {
    return NextResponse.json({ error: 'تمت معالجة الطلب مسبقاً' }, { status: 409 })
  }

  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(admin, scope, before.debtor_id)
  if (!gate.ok) return gate.error

  const { data: debtorMeta } = await admin
    .from('debtors')
    .select('full_name')
    .eq('id', before.debtor_id)
    .maybeSingle()

  const { data: rpcResult, error: rpcErr } = await admin.rpc(
    'approve_payment_noncompliance_request',
    { p_request_id: requestId, p_reviewer_id: auth.profile.id },
  )

  if (rpcErr) {
    if (rpcErr.message?.includes('approve_payment_noncompliance_request') || rpcErr.code === '42883') {
      return NextResponse.json({
        error: 'دالة الموافقة غير مفعّلة — شغّل supabase/scripts/apply-payment-noncompliance-requests.sql',
      }, { status: 500 })
    }
    console.error('[payment-noncompliance:approve]', rpcErr.message)
    return NextResponse.json({ error: 'فشل الموافقة' }, { status: 500 })
  }

  const result = rpcResult as { ok?: boolean; error?: string; code?: string; new_task_id?: string } | null
  if (!result?.ok) {
    const status = result?.code === 'already_processed' ? 409 : 400
    return NextResponse.json({
      error: result?.error ?? 'فشل الموافقة',
      code: result?.code,
    }, { status })
  }

  await logActivity({
    action: 'approve_payment_noncompliance_request',
    entity_type: 'debtor',
    entity_id: before.debtor_id,
    description: `موافقة طلب عدم التزام وإعادة آخر مهمة غير مكلفة: ${debtorMeta?.full_name ?? ''}`,
    metadata: { request_id: requestId, new_task_id: result.new_task_id },
    case_type: gate.caseType,
  }, auth.supabase)

  return NextResponse.json({
    ok: true,
    new_task_id: result.new_task_id,
  })
}
