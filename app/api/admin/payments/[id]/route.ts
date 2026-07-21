import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canDelete, canEditRecords } from '@/lib/permissions'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { requireDebtorInScope } from '@/lib/section-guard'
import { logActivity } from '@/lib/activity-log'
import { syncDebtorRemainingAfterPayments } from '@/lib/debtor-balances'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'

type RouteContext = { params: Promise<{ id: string }> }

async function loadPaymentInScope(paymentId: string, auth: Awaited<ReturnType<typeof requireStaffProfile>>) {
  const admin = createAdminClient()
  const { data: payment, error } = await admin
    .from('debtor_payments')
    .select('id, debtor_id, amount, notes, payment_date, branch_id')
    .eq('id', paymentId)
    .maybeSingle()

  if (error) return { ok: false as const, error: apiServerError('payments:load', error, 'فشل تحميل الدفعة') }
  if (!payment) return { ok: false as const, error: safeClientError('الدفعة غير موجودة', 404) }

  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(
    admin,
    scope,
    payment.debtor_id,
    'id, branch_id, case_type, remaining_amount, full_name',
  )
  if (!gate.ok) return { ok: false as const, error: gate.error }

  const debtor = gate.data as {
    id: string
    branch_id: string | null
    remaining_amount?: number | null
    full_name?: string | null
  }
  if (!canStaffWriteBranch(auth.profile, debtor.branch_id)) {
    return { ok: false as const, error: apiForbiddenResponse() }
  }

  return { ok: true as const, admin, payment, debtor, caseType: gate.caseType }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canEditRecords(auth.profile?.role)) return apiForbiddenResponse()

  const { id } = await params
  const loaded = await loadPaymentInScope(id, auth)
  if (!loaded.ok) return loaded.error

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const amount = Number(body.amount)
  const notes = body.notes !== undefined ? (String(body.notes ?? '').trim() || null) : loaded.payment.notes

  if (!Number.isFinite(amount) || amount <= 0) {
    return safeClientError('المبلغ يجب أن يكون أكبر من صفر', 400)
  }

  const remaining = Number(loaded.debtor.remaining_amount ?? 0)
  const oldAmount = Number(loaded.payment.amount ?? 0)
  const oldNotes = loaded.payment.notes
  const maxAllowed = remaining + oldAmount
  if (amount > maxAllowed) {
    return safeClientError(`المبلغ يتجاوز المتبقي المسموح (${maxAllowed})`, 400)
  }

  const { error: updErr } = await loaded.admin
    .from('debtor_payments')
    .update({ amount, notes })
    .eq('id', id)

  if (updErr) return apiServerError('payments:update', updErr, 'فشل تعديل الدفعة')

  const syncResult = await syncDebtorRemainingAfterPayments(loaded.admin, loaded.payment.debtor_id)
  if (!syncResult.ok) {
    await loaded.admin
      .from('debtor_payments')
      .update({ amount: oldAmount, notes: oldNotes })
      .eq('id', id)
    return apiServerError('payments:sync', syncResult.error, 'فشل تحديث المتبقي')
  }

  await logActivity({
    action: 'update_payment',
    entity_type: 'payment',
    entity_id: id,
    description: `تعديل تسديد: ${amount} — ${loaded.debtor.full_name ?? ''}`,
    case_type: loaded.caseType,
  }, auth.supabase)

  return NextResponse.json({ ok: true, case_type: loaded.caseType })
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canDelete(auth.profile?.role)) return apiForbiddenResponse()

  const { id } = await params
  const loaded = await loadPaymentInScope(id, auth)
  if (!loaded.ok) return loaded.error

  const snapshot = {
    debtor_id: loaded.payment.debtor_id,
    amount: loaded.payment.amount,
    notes: loaded.payment.notes,
    payment_date: loaded.payment.payment_date,
    branch_id: loaded.payment.branch_id,
  }

  const { error: delErr } = await loaded.admin.from('debtor_payments').delete().eq('id', id)
  if (delErr) return apiServerError('payments:delete', delErr, 'فشل حذف الدفعة')

  const syncResult = await syncDebtorRemainingAfterPayments(loaded.admin, loaded.payment.debtor_id)
  if (!syncResult.ok) {
    await loaded.admin.from('debtor_payments').insert(snapshot)
    return apiServerError('payments:sync', syncResult.error, 'فشل تحديث المتبقي')
  }

  await logActivity({
    action: 'delete_payment',
    entity_type: 'payment',
    entity_id: id,
    description: `حذف تسديد: ${loaded.payment.amount} — ${loaded.debtor.full_name ?? ''}`,
    case_type: loaded.caseType,
  }, auth.supabase)

  return NextResponse.json({ ok: true, case_type: loaded.caseType })
}
