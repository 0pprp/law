import {
  canApproveCompletions,
  canAssignTasks,
  canEditDebtor,
} from '@/lib/permissions'
import {
  extractHearingDateFromCompletion,
  normalizeHearingYmd,
  syncHearingDateInCompletion,
} from '@/lib/hearing-date-from-completion'

export type HearingPostponementRow = {
  id: string
  debtor_id: string
  old_date: string
  new_date: string
  reason: string
  created_by: string | null
  created_at: string
  created_by_name?: string | null
}

export function isHearingPostponeAllowed(role: string | null | undefined): boolean {
  return canAssignTasks(role) || canApproveCompletions(role) || canEditDebtor(role)
}

type AdminClient = {
  from: (table: string) => any
}

/**
 * يؤجّل تاريخ المرافعة: يحفظ القديميم في السجل، يحدّث first_hearing_date،
 * ويُزامن completion_data لمهام المرافعات/إقامة الدعوى ذات الصلة.
 */
export async function postponeHearingDate(params: {
  admin: AdminClient
  debtorId: string
  newDate: string
  reason: string
  actorId: string | null
}): Promise<
  | { ok: true; oldDate: string; newDate: string; historyTable: boolean }
  | { ok: false; error: string; status?: number }
> {
  const newDate = normalizeHearingYmd(params.newDate)
  if (!newDate) return { ok: false, error: 'تاريخ المرافعة الجديد غير صالح', status: 400 }

  const reason = String(params.reason ?? '').trim()
  if (!reason) return { ok: false, error: 'سبب التأجيل مطلوب', status: 400 }
  if (reason.length > 500) return { ok: false, error: 'السبب طويل جداً (حد أقصى 500 حرف)', status: 400 }

  const { data: debtor, error: dErr } = await params.admin
    .from('debtors')
    .select('id, full_name, first_hearing_date, current_task_id, case_type')
    .eq('id', params.debtorId)
    .maybeSingle()

  if (dErr) return { ok: false, error: dErr.message, status: 500 }
  if (!debtor) return { ok: false, error: 'المدين غير موجود', status: 404 }

  let oldDate = normalizeHearingYmd(debtor.first_hearing_date)

  // إن لم يكن على المدين، حاول من المهمة الحالية / مهام المرافعات
  if (!oldDate && debtor.current_task_id) {
    const { data: cur } = await params.admin
      .from('tasks')
      .select('completion_data')
      .eq('id', debtor.current_task_id)
      .maybeSingle()
    oldDate = extractHearingDateFromCompletion(cur?.completion_data as Record<string, unknown> | null)
  }

  if (!oldDate) {
    return { ok: false, error: 'لا يوجد تاريخ مرافعة حالي لتأجيله', status: 400 }
  }
  if (oldDate === newDate) {
    return { ok: false, error: 'التاريخ الجديد مطابق للتاريخ الحالي', status: 400 }
  }

  const { error: histErr } = await params.admin.from('hearing_postponements').insert({
    debtor_id: params.debtorId,
    old_date: oldDate,
    new_date: newDate,
    reason,
    created_by: params.actorId,
  })

  let historyPersisted = !histErr
  if (histErr) {
    const msg = histErr.message ?? ''
    const missingTable =
      msg.includes('hearing_postponements')
      || msg.includes('schema cache')
      || histErr.code === '42P01'
      || histErr.code === 'PGRST205'
    if (!missingTable) {
      return { ok: false, error: histErr.message, status: 500 }
    }
    // الجدول غير مفعّل بعد — نكمل ونعتمد activity_logs + ملاحظة المدين كسجل
    historyPersisted = false
  }

  const { error: updErr } = await params.admin
    .from('debtors')
    .update({ first_hearing_date: newDate })
    .eq('id', params.debtorId)

  if (updErr) return { ok: false, error: updErr.message, status: 500 }

  // ملاحظة ظاهرة في بروفايل المدين
  if (params.actorId) {
    await params.admin.from('debtor_notes').insert({
      debtor_id: params.debtorId,
      user_id: params.actorId,
      message: `تأجّلت المرافعة من ${oldDate} إلى ${newDate} — السبب: ${reason}`,
    })
  }

  // مزامنة completion_data لمهام المرافعات وإقامة الدعوى
  const { data: tasks } = await params.admin
    .from('tasks')
    .select('id, task_type, completion_data, task_definitions(label)')
    .eq('debtor_id', params.debtorId)

  for (const t of tasks ?? []) {
    const label = Array.isArray(t.task_definitions)
      ? t.task_definitions[0]?.label
      : (t.task_definitions as { label?: string } | null)?.label
    const prev = (t.completion_data ?? {}) as Record<string, unknown>
    const isPleading = t.task_type === 'pleading' || String(label ?? '').includes('مرافع')
    const isLawsuit = t.task_type === 'file_lawsuit' || String(label ?? '').includes('إقامة دعوى')
    const hadHearing = Boolean(extractHearingDateFromCompletion(prev))
    if (!isPleading && !isLawsuit && !hadHearing) continue
    const next = syncHearingDateInCompletion(prev, newDate)
    await params.admin.from('tasks').update({ completion_data: next }).eq('id', t.id)
  }

  return { ok: true, oldDate, newDate, historyTable: historyPersisted }
}
