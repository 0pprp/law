import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, isAdmin, isLegalManager } from '@/lib/permissions'
import { logActivity } from '@/lib/activity-log'

const NOTE_MAX_LENGTH = 2000

/**
 * تعديل ملاحظة «الأسماء التي تحت إسناد مهمة» — المدير ومسؤول القانونية فقط.
 * الكتابة تتم بمفتاح service_role بعد التحقق من الدور هنا.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const role = auth.profile?.role
  if (!isAdmin(role) && !isLegalManager(role)) {
    return apiForbiddenResponse()
  }

  let body: { debtorId?: string; note?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const debtorId = String(body.debtorId ?? '').trim()
  if (!debtorId) {
    return NextResponse.json({ error: 'معرّف المدين مطلوب' }, { status: 400 })
  }
  const note = String(body.note ?? '').trim().slice(0, NOTE_MAX_LENGTH)

  const admin = createAdminClient()
  const { data: debtor, error: debtorErr } = await admin
    .from('debtors')
    .select('id, full_name, current_task_id')
    .eq('id', debtorId)
    .maybeSingle()

  if (debtorErr || !debtor) {
    return NextResponse.json({ error: 'المدين غير موجود' }, { status: 404 })
  }

  const { error: updErr } = await admin
    .from('debtors')
    .update({ assignment_note: note || null })
    .eq('id', debtorId)

  if (updErr) {
    if (updErr.message?.includes('assignment_note')) {
      return NextResponse.json({
        error: 'حقل الملاحظة غير مفعّل بعد — شغّل supabase/scripts/apply-debtor-assignment-note.sql',
      }, { status: 500 })
    }
    console.error('[debtors/assignment-note]', updErr.message)
    return NextResponse.json({ error: 'فشل حفظ الملاحظة' }, { status: 500 })
  }

  await logActivity({
    action: 'update_debtor',
    entity_type: 'debtor',
    entity_id: debtor.id,
    description: note
      ? `تعديل ملاحظة إسناد المهمة للمدين: ${debtor.full_name ?? ''}`
      : `مسح ملاحظة إسناد المهمة للمدين: ${debtor.full_name ?? ''}`,
  }, auth.supabase)

  return NextResponse.json({ ok: true, note: note || null })
}
