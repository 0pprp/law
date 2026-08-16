import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, isChiefAccountant } from '@/lib/permissions'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'
import { isAssignedToChief } from '@/lib/chief-accountant-access'
import { formatLastNotePreview } from '@/lib/debtor-last-notes'

const MAX_IDS = 500
const NOTE_MAX = 2000

type FailRow = { id: string; name: string; reason: string }

function parseDebtorIds(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { debtorIds?: unknown }).debtorIds
  if (!Array.isArray(raw)) return null
  const ids = [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))]
  return ids.length ? ids.slice(0, MAX_IDS) : null
}

/**
 * إرجاع مدينين من تجهيز الملفات إلى «تحت إسناد مهمة» مع تسجيل سبب في الملاحظات.
 * المحاسب الرئيسي فقط — للأسماء المعيَّنة له وقيد التجهيز.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!isChiefAccountant(auth.profile?.role)) return apiForbiddenResponse()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const debtorIds = parseDebtorIds(body)
  const reason = String((body as { reason?: unknown })?.reason ?? '').trim()
  if (!debtorIds) return safeClientError('معرّفات المدينين مطلوبة', 400)
  if (!reason) return safeClientError('سبب الإرسال مطلوب', 400)
  if (reason.length > NOTE_MAX) {
    return safeClientError(`السبب يجب ألا يتجاوز ${NOTE_MAX} حرف`, 400)
  }

  const admin = createAdminClient()
  const userId = auth.user!.id
  const writerName = auth.profile?.full_name?.trim() || 'محاسب رئيسي'
  const noteMessage = `إرسال بدون تجهيز: ${reason}`

  const { data: targets, error: targetsErr } = await admin
    .from('debtors')
    .select('id, full_name, file_preparation_status, assigned_chief_accountant_id, case_type')
    .in('id', debtorIds)

  if (targetsErr) {
    if (
      String(targetsErr.message ?? '').includes('file_preparation_status')
      || String(targetsErr.message ?? '').includes('assigned_chief_accountant')
    ) {
      return safeClientError('أعمدة تجهيز الملفات غير مفعّلة بعد — طبّق الهجرة أولاً', 400)
    }
    return apiServerError('return-without-preparation:targets', targetsErr)
  }

  if (!targets?.length) return safeClientError('لم يُعثر على المدينين المحددين', 404)

  const failed: FailRow[] = []
  const okIds: string[] = []

  for (const d of targets) {
    const name = d.full_name?.trim() || d.id
    if (!isAssignedToChief(userId, d)) {
      failed.push({ id: d.id, name, reason: 'المدين غير معيَّن لك' })
      continue
    }
    if (d.file_preparation_status !== 'preparing') {
      failed.push({ id: d.id, name, reason: 'المدين ليس قيد التجهيز' })
      continue
    }
    okIds.push(d.id)
  }

  if (!okIds.length) {
    return NextResponse.json(
      {
        ok: false,
        error: failed[0]?.reason ?? 'تعذر الإرجاع',
        updated: 0,
        failed,
      },
      { status: 400 },
    )
  }

  const { error: updErr } = await admin
    .from('debtors')
    .update({
      file_preparation_status: null,
      assigned_chief_accountant_id: null,
      assignment_note: noteMessage,
    })
    .in('id', okIds)

  if (updErr) {
    // assignment_note قد يكون غير مطبّق — أعد المحاولة بدونها
    if (String(updErr.message ?? '').includes('assignment_note')) {
      const { error: upd2 } = await admin
        .from('debtors')
        .update({
          file_preparation_status: null,
          assigned_chief_accountant_id: null,
        })
        .in('id', okIds)
      if (upd2) return apiServerError('return-without-preparation:update', upd2)
    } else {
      return apiServerError('return-without-preparation:update', updErr)
    }
  }

  const noteRows = okIds.map(id => ({
    debtor_id: id,
    user_id: userId,
    message: noteMessage,
  }))
  const { error: noteErr } = await admin.from('debtor_notes').insert(noteRows)
  if (noteErr) {
    console.warn('[return-without-preparation:notes]', noteErr.message)
  }

  await logActivity({
    action: 'return_without_preparation',
    entity_type: 'debtor',
    description: `إرسال بدون تجهيز لـ ${okIds.length} مدين — ${reason}`,
    metadata: {
      debtorIds: okIds,
      reason,
      failedCount: failed.length,
    },
  }, auth.supabase)

  return NextResponse.json({
    ok: true,
    updated: okIds.length,
    updatedIds: okIds,
    failed,
    lastNote: formatLastNotePreview(writerName, noteMessage),
  })
}
