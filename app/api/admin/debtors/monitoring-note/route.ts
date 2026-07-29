import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canManageSpecialStatuses } from '@/lib/permissions'
import { requireDebtorInScope } from '@/lib/section-guard'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'
import { formatLastNotePreview } from '@/lib/debtor-last-notes'

const NOTE_MAX_LENGTH = 2000

export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canManageSpecialStatuses(auth.profile?.role)) return apiForbiddenResponse()

  let body: { debtorId?: unknown; note?: unknown }
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const debtorId = String(body.debtorId ?? '').trim()
  const note = String(body.note ?? '').trim()
  if (!debtorId) return safeClientError('معرّف المدين مطلوب', 400)
  if (!note) return safeClientError('نص الملاحظة مطلوب', 400)
  if (note.length > NOTE_MAX_LENGTH) {
    return safeClientError(`الملاحظة يجب ألا تتجاوز ${NOTE_MAX_LENGTH} حرف`, 400)
  }

  const admin = createAdminClient()
  const gate = await requireDebtorInScope(
    admin,
    sessionCaseScope(auth.profile),
    debtorId,
    'id, full_name, case_type',
  )
  if (!gate.ok) return gate.error

  const debtor = gate.data as { id: string; full_name: string | null }
  const { error } = await admin.from('debtor_notes').insert({
    debtor_id: debtorId,
    user_id: auth.user!.id,
    message: note,
  })
  if (error) return apiServerError('monitoring-note:create', error)

  await logActivity({
    action: 'add_debtor_note',
    entity_type: 'debtor',
    entity_id: debtorId,
    description: `إضافة ملاحظة متابعة للمدين: ${debtor.full_name ?? ''}`,
    case_type: gate.caseType,
  }, auth.supabase)

  return NextResponse.json({
    ok: true,
    lastNote: formatLastNotePreview(auth.profile?.full_name, note),
  })
}
