import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canAddPayments } from '@/lib/permissions'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { requireDebtorInScope } from '@/lib/section-guard'
import { logActivity } from '@/lib/activity-log'
import { syncDebtorRemainingAfterPayments } from '@/lib/debtor-balances'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * تسجيل دفعة — case_type من المدين في DB فقط.
 * Idempotency عبر client_request_id (عمود رسمي).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canAddPayments(auth.profile?.role)) return apiForbiddenResponse()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const debtorId = String(body.debtorId ?? body.debtor_id ?? '').trim()
  const amount = Number(body.amount)
  const notes = String(body.notes ?? '').trim() || null
  const paymentDate = String(body.payment_date ?? '').trim() || new Date().toISOString().split('T')[0]
  const clientRequestRaw = String(body.clientRequestId ?? body.client_request_id ?? '').trim() || null
  const clientRequestId =
    clientRequestRaw && UUID_RE.test(clientRequestRaw) ? clientRequestRaw.toLowerCase() : null

  if (!debtorId) return safeClientError('المدين مطلوب', 400)
  if (!Number.isFinite(amount) || amount <= 0) return safeClientError('المبلغ يجب أن يكون أكبر من صفر', 400)
  if (clientRequestRaw && !clientRequestId) {
    return safeClientError('clientRequestId يجب أن يكون UUID صالحاً', 400)
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    return safeClientError('تاريخ الدفع غير صالح', 400)
  }

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(
    admin,
    scope,
    debtorId,
    'id, branch_id, case_type, remaining_amount, full_name',
  )
  if (!gate.ok) return gate.error

  const debtor = gate.data as {
    id: string
    branch_id: string | null
    case_type?: string
    remaining_amount?: number | null
    full_name?: string | null
  }

  if (!canStaffWriteBranch(auth.profile, debtor.branch_id)) return apiForbiddenResponse()

  const remaining = Number(debtor.remaining_amount ?? 0)
  if (amount > remaining) {
    return safeClientError(`المبلغ يتجاوز المتبقي (${remaining})`, 400)
  }

  if (clientRequestId) {
    const { data: byRef } = await admin
      .from('debtor_payments')
      .select('id')
      .eq('created_by', auth.user!.id)
      .eq('client_request_id', clientRequestId)
      .limit(1)
      .maybeSingle()
    if (byRef) {
      return NextResponse.json({ ok: true, id: byRef.id, duplicate: true, case_type: gate.caseType })
    }
  }

  const since = new Date(Date.now() - 60_000).toISOString()
  const { data: recentDup } = await admin
    .from('debtor_payments')
    .select('id')
    .eq('debtor_id', debtorId)
    .eq('amount', amount)
    .gte('created_at', since)
    .limit(1)
    .maybeSingle()
  if (recentDup) {
    return NextResponse.json({ ok: true, id: recentDup.id, duplicate: true, case_type: gate.caseType })
  }

  const { data: inserted, error: insertErr } = await admin
    .from('debtor_payments')
    .insert({
      debtor_id: debtorId,
      amount,
      payment_date: paymentDate,
      notes,
      branch_id: debtor.branch_id,
      created_by: auth.user!.id,
      ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    // Unique violation on idempotency key → treat as duplicate
    if (insertErr?.code === '23505' && clientRequestId) {
      const { data: existing } = await admin
        .from('debtor_payments')
        .select('id')
        .eq('created_by', auth.user!.id)
        .eq('client_request_id', clientRequestId)
        .maybeSingle()
      if (existing) {
        return NextResponse.json({ ok: true, id: existing.id, duplicate: true, case_type: gate.caseType })
      }
    }
    return apiServerError('payments:insert', insertErr, 'فشل تسجيل الدفعة')
  }

  const syncResult = await syncDebtorRemainingAfterPayments(admin, debtorId)
  if (!syncResult.ok) {
    await admin.from('debtor_payments').delete().eq('id', inserted.id)
    return apiServerError('payments:sync', syncResult.error, 'فشل تحديث المتبقي')
  }

  await logActivity({
    action: 'add_payment',
    entity_type: 'payment',
    entity_id: inserted.id,
    description: `تسجيل تسديد: ${amount} — ${debtor.full_name ?? debtorId}`,
    case_type: gate.caseType,
  }, auth.supabase)

  return NextResponse.json({
    ok: true,
    id: inserted.id,
    case_type: gate.caseType,
  })
}
