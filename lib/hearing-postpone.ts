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
import { isFileLawsuitTask, isPleadingTask } from '@/lib/default-next-task'
import { OVERDUE_TERMINAL_STATUSES } from '@/lib/local-date'
import { TASK_TYPE_LABELS, type TaskType } from '@/lib/types'
import { ensurePleadingLinkedTwin } from '@/lib/pleading-notification-twin'

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

export type PostponeLinkedTaskOption = {
  id: string
  label: string
  task_type: string | null
  task_status: string
  status_label: string
}

export function isHearingPostponeAllowed(role: string | null | undefined): boolean {
  return canAssignTasks(role) || canApproveCompletions(role) || canEditDebtor(role)
}

type AdminClient = {
  from: (table: string) => any
}

const TERMINAL = new Set<string>(OVERDUE_TERMINAL_STATUSES)

function defLabel(raw: { label?: string | null } | { label?: string | null }[] | null | undefined): string {
  const row = Array.isArray(raw) ? raw[0] : raw
  return String(row?.label ?? '').trim()
}

function isLawsuitDef(def: { task_type?: string | null; label?: string | null }): boolean {
  return isFileLawsuitTask({ task_type: def.task_type, label: def.label })
}

/** قائمة تعريفات المهام في فرع المدين — عدا إقامة الدعوى */
export async function listPostponeLinkedTasks(
  admin: AdminClient,
  debtorId: string,
): Promise<PostponeLinkedTaskOption[]> {
  const { data: debtor, error: dErr } = await admin
    .from('debtors')
    .select('branch_id, case_type')
    .eq('id', debtorId)
    .maybeSingle()
  if (dErr || !debtor) {
    if (dErr) console.warn('[postpone-linked-tasks]', dErr.message)
    return []
  }

  const caseType = debtor.case_type === 'criminal' ? 'criminal' : 'civil'
  let q = admin
    .from('task_definitions')
    .select('id, label, task_type, sort_order, branch_id')
    .eq('is_active', true)
    .eq('case_type', caseType)
    .order('sort_order')

  const { data, error } = await q
  if (error) {
    console.warn('[postpone-linked-tasks:defs]', error.message)
    return []
  }

  let defs = (data ?? []) as { id: string; label?: string | null; task_type?: string | null; branch_id?: string | null }[]
  if (debtor.branch_id) {
    const inBranch = defs.filter(d => d.branch_id === debtor.branch_id)
    if (inBranch.some(d => !isLawsuitDef(d))) defs = inBranch
  }

  const out: PostponeLinkedTaskOption[] = []
  for (const d of defs) {
    if (isLawsuitDef(d)) continue
    const label = String(d.label ?? '').trim()
      || (d.task_type && d.task_type in TASK_TYPE_LABELS
        ? TASK_TYPE_LABELS[d.task_type as TaskType]
        : 'مهمة')
    out.push({
      id: d.id,
      label,
      task_type: d.task_type ?? null,
      task_status: '',
      status_label: d.task_type && d.task_type in TASK_TYPE_LABELS
        ? TASK_TYPE_LABELS[d.task_type as TaskType]
        : '',
    })
  }
  return out
}

async function resolveLinkedTask(
  admin: AdminClient,
  debtorId: string,
  linkedId: string,
): Promise<{
  id: string
  debtor_id: string
  task_type: string | null
  completion_data: Record<string, unknown> | null
  task_definitions: { label?: string | null } | { label?: string | null }[] | null
} | null> {
  const { data: asTask } = await admin
    .from('tasks')
    .select('id, debtor_id, task_type, task_status, completion_data, task_definitions(label, task_type)')
    .eq('id', linkedId)
    .maybeSingle()

  if (asTask && asTask.debtor_id === debtorId && !isFileLawsuitTask(asTask as any)) {
    return asTask
  }

  const { data: def } = await admin
    .from('task_definitions')
    .select('id, label, task_type')
    .eq('id', linkedId)
    .maybeSingle()
  if (!def || isLawsuitDef(def)) return null

  const { data: instances } = await admin
    .from('tasks')
    .select('id, debtor_id, task_type, task_status, completion_data, task_definitions(label, task_type)')
    .eq('debtor_id', debtorId)
    .eq('task_definition_id', def.id)
    .order('created_at', { ascending: false })
    .limit(20)

  let rows = instances ?? []
  if (!rows.length && def.task_type) {
    const { data: byType } = await admin
      .from('tasks')
      .select('id, debtor_id, task_type, task_status, completion_data, task_definitions(label, task_type)')
      .eq('debtor_id', debtorId)
      .eq('task_type', def.task_type)
      .order('created_at', { ascending: false })
      .limit(20)
    rows = byType ?? []
  }
  const live = rows.find((t: { task_status?: string | null }) => !TERMINAL.has(String(t.task_status ?? '')))
  return (live ?? rows[0] ?? null) as any
}

/**
 * يؤجّل تاريخ المرافعة: يحفظ القديم في السجل، يحدّث first_hearing_date،
 * ويُزامن completion_data لمهام المرافعات.
 * المهمة المرتبطة تُحدَّث فقط إذا اختارها المستخدم.
 */
export async function postponeHearingDate(params: {
  admin: AdminClient
  debtorId: string
  newDate: string
  reason: string
  actorId: string | null
  linkedTaskId?: string | null
}): Promise<
  | { ok: true; oldDate: string; newDate: string; historyTable: boolean }
  | { ok: false; error: string; status?: number }
> {
  const newDate = normalizeHearingYmd(params.newDate)
  if (!newDate) return { ok: false, error: 'تاريخ المرافعة الجديد غير صالح', status: 400 }

  const reason = String(params.reason ?? '').trim()
  if (!reason) return { ok: false, error: 'سبب التأجيل مطلوب', status: 400 }
  if (reason.length > 500) return { ok: false, error: 'السبب طويل جداً (حد أقصى 500 حرف)', status: 400 }

  const linkedTaskId = String(params.linkedTaskId ?? '').trim() || null

  const { data: debtor, error: dErr } = await params.admin
    .from('debtors')
    .select('id, full_name, first_hearing_date, current_task_id, case_type, branch_id')
    .eq('id', params.debtorId)
    .maybeSingle()

  if (dErr) return { ok: false, error: dErr.message, status: 500 }
  if (!debtor) return { ok: false, error: 'المدين غير موجود', status: 404 }

  let oldDate = normalizeHearingYmd(debtor.first_hearing_date)

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

  let linkedTask: {
    id: string
    debtor_id: string
    task_type: string | null
    completion_data: Record<string, unknown> | null
    task_definitions: { label?: string | null } | { label?: string | null }[] | null
  } | null = null
  let linkedDefLabel: string | null = null

  if (linkedTaskId) {
    const { data: def } = await params.admin
      .from('task_definitions')
      .select('id, label, task_type, fee_amount')
      .eq('id', linkedTaskId)
      .maybeSingle()
    if (def && isLawsuitDef(def)) {
      return { ok: false, error: 'لا يمكن ربط التأجيل بمهمة إقامة دعوى', status: 400 }
    }
    if (def) linkedDefLabel = String(def.label ?? '').trim() || null
    linkedTask = await resolveLinkedTask(params.admin, params.debtorId, linkedTaskId)
    if (!def && !linkedTask) {
      return { ok: false, error: 'المهمة المرتبطة غير صالحة لهذا المدين', status: 400 }
    }

    if (def) {
      let pleadingId = debtor.current_task_id as string | null
      if (pleadingId) {
        const { data: cur } = await params.admin
          .from('tasks')
          .select('id, task_type, task_definitions(task_type, label)')
          .eq('id', pleadingId)
          .maybeSingle()
        if (!cur || !isPleadingTask(cur as any)) pleadingId = null
      }
      if (!pleadingId) {
        const { data: pleadingRow } = await params.admin
          .from('tasks')
          .select('id')
          .eq('debtor_id', params.debtorId)
          .eq('task_type', 'pleading')
          .in('task_status', ['waiting_assignment', 'new', 'draft', 'assignment_pending_acceptance', 'assigned', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        pleadingId = pleadingRow?.id ?? debtor.current_task_id
      }
      if (pleadingId) {
        const created = await ensurePleadingLinkedTwin(
          params.admin,
          {
            id: pleadingId,
            debtor_id: params.debtorId,
            branch_id: debtor.branch_id ?? null,
            due_date: newDate,
          },
          {
            id: def.id,
            label: def.label,
            task_type: def.task_type,
            fee_amount: def.fee_amount ?? 0,
          },
          { hearingDate: newDate, createdBy: params.actorId },
        )
        if (created.twinId) {
          linkedTask = {
            id: created.twinId,
            debtor_id: params.debtorId,
            task_type: def.task_type ?? null,
            completion_data: null,
            task_definitions: { label: def.label },
          }
        }
      }
    }
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
    historyPersisted = false
  }

  const { error: updErr } = await params.admin
    .from('debtors')
    .update({ first_hearing_date: newDate })
    .eq('id', params.debtorId)

  if (updErr) return { ok: false, error: updErr.message, status: 500 }

  if (params.actorId) {
    const linkedName = linkedDefLabel
      || (linkedTask ? (defLabel(linkedTask.task_definitions) || linkedTask.task_type || 'مهمة') : '')
    const linkedNote = linkedName ? ` — المهمة المرتبطة: ${linkedName}` : ''
    await params.admin.from('debtor_notes').insert({
      debtor_id: params.debtorId,
      user_id: params.actorId,
      message: `تأجّلت المرافعة من ${oldDate} إلى ${newDate} — السبب: ${reason}${linkedNote}`,
    })
  }

  const { data: tasks } = await params.admin
    .from('tasks')
    .select('id, task_type, completion_data, task_definitions(label)')
    .eq('debtor_id', params.debtorId)

  for (const t of tasks ?? []) {
    if (!isPleadingTask(t as any)) continue
    const prev = (t.completion_data ?? {}) as Record<string, unknown>
    const next = syncHearingDateInCompletion(prev, newDate)
    await params.admin.from('tasks').update({
      completion_data: next,
      due_date: newDate,
    }).eq('id', t.id)
  }

  if (linkedTask) {
    const prev = (linkedTask.completion_data ?? {}) as Record<string, unknown>
    const next = syncHearingDateInCompletion(prev, newDate)
    await params.admin.from('tasks').update({
      due_date: newDate,
      completion_data: next,
    }).eq('id', linkedTask.id)
  }

  return { ok: true, oldDate, newDate, historyTable: historyPersisted }
}
