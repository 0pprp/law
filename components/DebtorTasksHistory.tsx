import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TASK_TYPE_LABELS } from '@/lib/types'
import type { TaskType } from '@/lib/types'
import { Card, CardHeader } from '@/components/ui/card'
import DebtorTasksHistoryList, { type DebtorTaskHistoryRow } from '@/components/DebtorTasksHistoryList'
import { extractHearingDateFromCompletion } from '@/lib/hearing-date-from-completion'
import { fetchStaffProfile } from '@/lib/staff-profile'
import { canStaffOrChiefReadDebtor } from '@/lib/chief-accountant-access'

function lawyerLabel(assignedTo: string | null, lawyerMap: Map<string, string>): string {
  if (!assignedTo) return 'غير مكلفة بعد'
  return lawyerMap.get(assignedTo) ?? '—'
}

function taskName(
  task: { task_type?: string | null; task_definition_id?: string | null },
  defMap: Map<string, string>,
): string {
  const fromDef = task.task_definition_id ? defMap.get(task.task_definition_id) : undefined
  return fromDef ?? TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type ?? '—'
}

function completionDate(task: { task_status: string; completed_at: string | null }): string | null {
  if (!task.completed_at) return null
  if (['submitted', 'pending_review', 'approved', 'completed', 'rejected', 'needs_revision'].includes(task.task_status)) {
    return task.completed_at
  }
  return null
}

function approvalDate(task: { task_status: string; updated_at: string | null }): string | null {
  if (task.task_status === 'approved' || task.task_status === 'completed') {
    return task.updated_at
  }
  return null
}

export default async function DebtorTasksHistory({
  debtorId,
  fullArchive = false,
}: {
  debtorId: string
  fullArchive?: boolean
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = user ? await fetchStaffProfile(supabase, user.id) : null
  const admin = createAdminClient()

  const { data: accessDebtor } = await admin
    .from('debtors')
    .select('id, branch_id, assigned_chief_accountant_id')
    .eq('id', debtorId)
    .maybeSingle()

  const canRead = accessDebtor
    && canStaffOrChiefReadDebtor(
      profile ? { ...profile, id: user!.id } : null,
      accessDebtor,
    )
  const db = canRead ? admin : supabase

  const selectCols = fullArchive
    ? 'id, task_type, task_status, assigned_to, assigned_at, accepted_at, completed_at, updated_at, created_at, task_definition_id, completion_data, lawyer_notes, legal_result'
    : 'id, task_type, task_status, assigned_to, assigned_at, accepted_at, completed_at, updated_at, created_at, task_definition_id'

  const [{ data: debtor }, { data: tasks }] = await Promise.all([
    db.from('debtors').select('current_task_id, first_hearing_date, full_name').eq('id', debtorId).single(),
    db
      .from('tasks')
      .select(selectCols)
      .eq('debtor_id', debtorId)
      .order('created_at', { ascending: false }),
  ])

  const currentTaskId = debtor?.current_task_id ?? null
  let debtorHearingDate = debtor?.first_hearing_date
    ? String(debtor.first_hearing_date).slice(0, 10)
    : null

  const taskList = (tasks ?? []) as unknown as Array<{
    id: string
    task_type: string | null
    task_status: string
    assigned_to: string | null
    assigned_at: string | null
    accepted_at: string | null
    completed_at: string | null
    updated_at: string | null
    created_at: string
    task_definition_id: string | null
    completion_data?: Record<string, unknown> | null
    lawyer_notes?: string | null
    legal_result?: string | null
  }>

  // مزامنة ناقصة: إن وُجد تاريخ جلسة في إنجاز سابق ولم يُحفظ على المدين
  if (!debtorHearingDate && fullArchive && canRead) {
    const lawsuit = taskList.find(t => t.task_type === 'file_lawsuit')
      ?? taskList.find(t => extractHearingDateFromCompletion(t.completion_data ?? null))
    const fromTask = extractHearingDateFromCompletion(lawsuit?.completion_data ?? null)
    if (fromTask) {
      debtorHearingDate = fromTask
      await admin
        .from('debtors')
        .update({ first_hearing_date: fromTask } as any)
        .eq('id', debtorId)
    }
  }

  const taskIds = taskList.map(t => t.id)

  const lawyerIds = [...new Set(taskList.map(t => t.assigned_to).filter(Boolean))] as string[]
  const defIds = [...new Set(taskList.map(t => t.task_definition_id).filter(Boolean))] as string[]

  const queries: PromiseLike<{ data: unknown }>[] = [
    lawyerIds.length > 0
      ? db.from('profiles').select('id, full_name, role').in('id', lawyerIds)
      : Promise.resolve({ data: [] }),
    defIds.length > 0
      ? db.from('task_definitions').select('id, label').in('id', defIds)
      : Promise.resolve({ data: [] }),
  ]

  if (fullArchive && taskIds.length > 0) {
    queries.push(
      db
        .from('task_attachments')
        .select('id, task_id, file_name, file_path, description')
        .in('task_id', taskIds)
        .order('created_at', { ascending: false }),
    )
  }

  const results = await Promise.all(queries)
  const lawyers = (results[0].data ?? []) as { id: string; full_name: string; role?: string | null }[]
  const defs = (results[1].data ?? []) as { id: string; label: string }[]
  const allAttachments = fullArchive && results[2]
    ? (results[2].data ?? []) as { id: string; task_id: string; file_name: string; file_path: string; description: string | null }[]
    : []

  const lawyerMap = new Map(lawyers.map(l => [l.id, l.full_name]))
  const roleMap = new Map(lawyers.map(l => [l.id, l.role ?? null]))
  const defMap = new Map(defs.map(d => [d.id, d.label]))
  const attByTask = new Map<string, typeof allAttachments>()
  for (const att of allAttachments) {
    const list = attByTask.get(att.task_id) ?? []
    list.push(att)
    attByTask.set(att.task_id, list)
  }

  const rows: DebtorTaskHistoryRow[] = taskList
    .map(t => {
      const completionData = fullArchive
        ? ((t.completion_data ?? null) as Record<string, string> | null)
        : null
      const fromCompletion = extractHearingDateFromCompletion(completionData)
      const defLabel = t.task_definition_id ? (defMap.get(t.task_definition_id) ?? '') : ''
      const isPleading = t.task_type === 'pleading' || defLabel.includes('مرافع')
      const isLawsuit = t.task_type === 'file_lawsuit' || defLabel.includes('إقامة دعوى')
      const hearingDate = isPleading
        ? (debtorHearingDate ?? fromCompletion)
        : fromCompletion

      return {
        id: t.id,
        label: taskName(t, defMap),
        lawyerName: lawyerLabel(t.assigned_to, lawyerMap),
        assigneeRole: t.assigned_to ? (roleMap.get(t.assigned_to) ?? null) : null,
        task_status: t.task_status,
        taskType: t.task_type,
        assignedAt: t.assigned_at ?? t.accepted_at ?? null,
        completedAt: completionDate(t),
        approvedAt: approvalDate(t),
        isCurrent: !!currentTaskId && t.id === currentTaskId,
        hearingDate,
        canEditHearingDate: isLawsuit,
        completionData,
        attachments: fullArchive ? (attByTask.get(t.id) ?? []) : [],
      }
    })
    .sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      return 0
    })

  return (
    <Card>
      <CardHeader title={`سجل المهام (${rows.length})`} />
      <DebtorTasksHistoryList
        rows={rows}
        fullArchive={fullArchive}
        debtorId={debtorId}
        debtorName={debtor?.full_name ?? null}
      />
    </Card>
  )
}
