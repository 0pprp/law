import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, isAdmin, isAnyLegalManager } from '@/lib/permissions'
import { logActivity } from '@/lib/activity-log'
import { requireDebtorInScope } from '@/lib/section-guard'

const NOTE_MAX_LENGTH = 2000

/**
 * تعديل ملاحظة «الأسماء التي تحت إسناد مهمة» — المدير ومسؤول القانونية فقط.
 * الكتابة تتم بمفتاح service_role بعد التحقق من الدور هنا.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const role = auth.profile?.role
  if (!isAdmin(role) && !isAnyLegalManager(role)) {
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
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(
    admin,
    scope,
    debtorId,
    'id, full_name, current_task_id, case_type',
  )
  if (!gate.ok) return gate.error

  const debtor = gate.data as { id: string; full_name: string | null }

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
    case_type: gate.caseType,
  }, auth.supabase)

  return NextResponse.json({ ok: true, note: note || null })
}
