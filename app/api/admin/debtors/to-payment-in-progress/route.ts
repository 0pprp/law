import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, canMoveToPaymentInProgress } from '@/lib/permissions'
import { CASE_STATUS_PAYMENT_IN_PROGRESS } from '@/lib/types'
import { logActivity } from '@/lib/activity-log'
import { finalizeTaskApproval, FEE_STATUS_AWAITING_NEXT_TASK } from '@/lib/task-approval'

const VALID_TYPES = new Set(['daily', 'weekly', 'monthly'])
const VALID_LOCATIONS = new Set(['company', 'execution'])

type MoveResult = { id: string; ok: boolean; name?: string; error?: string }

/**
 * تحويل مدين (أو أكثر) إلى جاري التسديد مع حفظ نوع/مكان التسديد.
 * المدير ومسؤول القانونية فقط.
 * يقبل debtorId مفرد أو debtorIds كمصفوفة (تحويل جماعي).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  if (!canMoveToPaymentInProgress(auth.profile?.role)) {
    return apiForbiddenResponse()
  }

  let body: {
    debtorId?: string
    debtorIds?: string[]
    paymentType?: string
    paymentLocation?: string
    taskId?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const paymentType = String(body.paymentType ?? '').trim()
  const paymentLocation = String(body.paymentLocation ?? '').trim()
  const taskId = String(body.taskId ?? '').trim() || null

  const ids = Array.from(
    new Set(
      (Array.isArray(body.debtorIds) ? body.debtorIds : [body.debtorId])
        .map(v => String(v ?? '').trim())
        .filter(Boolean)
    )
  )

  if (ids.length === 0) {
    return NextResponse.json({ error: 'معرّف المدين مطلوب' }, { status: 400 })
  }
  if (!VALID_TYPES.has(paymentType)) {
    return NextResponse.json({ error: 'يجب اختيار نوع التسديد' }, { status: 400 })
  }
  if (!VALID_LOCATIONS.has(paymentLocation)) {
    return NextResponse.json({ error: 'يجب اختيار مكان التسديد' }, { status: 400 })
  }

  const admin = createAdminClient()
  const results: MoveResult[] = []

  for (const debtorId of ids) {
    const { data: debtor, error: debtorErr } = await admin
      .from('debtors')
      .select('id, full_name, case_status, current_task_id, last_task_id')
      .eq('id', debtorId)
      .maybeSingle()

    if (debtorErr || !debtor) {
      results.push({ id: debtorId, ok: false, error: 'المدين غير موجود' })
      continue
    }
    if (debtor.case_status === 'closed') {
      results.push({ id: debtorId, ok: false, name: debtor.full_name, error: 'قضية مغلقة' })
      continue
    }
    if (debtor.case_status === CASE_STATUS_PAYMENT_IN_PROGRESS) {
      results.push({ id: debtorId, ok: false, name: debtor.full_name, error: 'في جاري التسديد مسبقاً' })
      continue
    }

    // في التحويل الجماعي taskId مشترك لا يُطبّق؛ نستخدم المهمة الحالية للمدين إن وُجدت
    const lastTaskId = (ids.length === 1 ? taskId : null) || debtor.current_task_id || null

    const payload: Record<string, unknown> = {
      case_status: CASE_STATUS_PAYMENT_IN_PROGRESS,
      payment_type: paymentType,
      payment_location: paymentLocation,
      current_task_id: null,
    }
    if (lastTaskId) payload.last_task_id = lastTaskId

    const { error: updErr } = await admin.from('debtors').update(payload).eq('id', debtorId)
    if (updErr) {
      if (updErr.message?.includes('payment_type') || updErr.message?.includes('payment_location')) {
        return NextResponse.json({
          error: 'حقول نوع/مكان التسديد غير مفعّلة — شغّل supabase/scripts/apply-debtor-payment-type-location.sql',
        }, { status: 500 })
      }
      console.error('[to-payment-in-progress]', updErr.message)
      results.push({ id: debtorId, ok: false, name: debtor.full_name, error: 'فشل التحويل' })
      continue
    }

    // مسار ختامي: مهمة معتمدة الإنجاز بانتظار الاعتماد النهائي — تُحتسب أتعابها هنا مرة واحدة
    if (lastTaskId) {
      const { data: prevTask } = await admin
        .from('tasks')
        .select('id, task_status, fee_status')
        .eq('id', lastTaskId)
        .maybeSingle()
      if (
        prevTask
        && ['approved', 'completed'].includes(prevTask.task_status as string)
        && (prevTask as { fee_status?: string | null }).fee_status === FEE_STATUS_AWAITING_NEXT_TASK
      ) {
        const finalizeResult = await finalizeTaskApproval(admin, prevTask.id, auth.user!.id)
        if (!finalizeResult.ok) {
          // تراجع عن التحويل — لا آثار مالية وتبقى المهمة بانتظار الإجراء اللاحق
          await admin.from('debtors').update({
            case_status: debtor.case_status ?? 'active',
            payment_type: null,
            payment_location: null,
            current_task_id: debtor.current_task_id ?? null,
            last_task_id: (debtor as { last_task_id?: string | null }).last_task_id ?? null,
          } as any).eq('id', debtorId)
          results.push({ id: debtorId, ok: false, name: debtor.full_name, error: finalizeResult.error ?? 'فشل الاعتماد النهائي للمهمة السابقة' })
          continue
        }
      }
    }

    await logActivity({
      action: 'move_to_payment_in_progress',
      entity_type: 'debtor',
      entity_id: debtor.id,
      description: `تحويل المدين إلى جاري التسديد: ${debtor.full_name ?? ''} — نوع: ${paymentType} · مكان: ${paymentLocation}`,
    }, auth.supabase)

    results.push({ id: debtorId, ok: true, name: debtor.full_name })
  }

  const moved = results.filter(r => r.ok)
  const failed = results.filter(r => !r.ok)

  // مدين واحد فشل → أعد الخطأ مباشرة (توافق مع الاستخدام المفرد)
  if (ids.length === 1 && failed.length === 1) {
    return NextResponse.json({ error: failed[0].error ?? 'فشل التحويل' }, { status: 400 })
  }

  return NextResponse.json({
    ok: moved.length > 0,
    moved: moved.length,
    failed: failed.length,
    payment_type: paymentType,
    payment_location: paymentLocation,
    results,
  })
}
