import { createClient } from '@/lib/supabase/server'
import { TASK_TYPE_LABELS, TASK_STATUS_LABELS } from '@/lib/types'
import type { TaskStatus, TaskType } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { fmtDate } from '@/lib/utils'
import { resolveCompletionFieldLabel } from '@/lib/completion-field-labels'
import { parseGps } from '@/lib/task-approval'

const STATUS_BADGE: Partial<Record<TaskStatus, 'default' | 'info' | 'warning' | 'success' | 'danger' | 'gray' | 'purple'>> = {
  draft: 'gray',
  waiting_assignment: 'warning',
  assignment_pending_acceptance: 'warning',
  assigned: 'info',
  in_progress: 'warning',
  submitted: 'purple',
  pending_review: 'purple',
  approved: 'success',
  rejected: 'danger',
  needs_revision: 'danger',
  completed: 'success',
  new: 'info',
  failed: 'danger',
  postponed: 'gray',
  needs_info: 'purple',
  closed: 'gray',
}

interface TaskRow {
  id: string
  label: string
  lawyerName: string
  task_status: string
  assignedAt: string | null
  completedAt: string | null
  approvedAt: string | null
  isCurrent: boolean
  completionData: Record<string, string> | null
  attachments: { id: string; file_name: string; description: string | null }[]
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return fmtDate(value.split('T')[0])
}

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

function CompletionFields({ data }: { data: Record<string, string> }) {
  const entries = Object.entries(data).filter(([, v]) => v != null && String(v).trim() !== '')
  if (!entries.length) return null
  return (
    <div className="mt-3 pt-3 border-t border-[rgba(118,118,118,0.08)]">
      <p className="text-[10px] font-bold text-[#767676] mb-2">الحقول المُدخلة</p>
      <div className="space-y-1.5">
        {entries.map(([key, val]) => {
          const label = resolveCompletionFieldLabel(key)
          const gps = parseGps(val)
          return (
            <div key={key} className="flex justify-between gap-3 text-xs">
              <span className="text-[#767676] shrink-0">{label}</span>
              {gps ? (
                <a
                  href={`https://www.google.com/maps?q=${gps.lat},${gps.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#2C8780] font-semibold font-mono"
                  dir="ltr"
                >
                  {gps.lat.toFixed(6)}, {gps.lng.toFixed(6)}
                </a>
              ) : (
                <span className="text-[#231F20] font-semibold text-left break-words">{val}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default async function DebtorTasksHistory({
  debtorId,
  fullArchive = false,
}: {
  debtorId: string
  fullArchive?: boolean
}) {
  const supabase = await createClient()

  const selectCols = fullArchive
    ? 'id, task_type, task_status, assigned_to, assigned_at, accepted_at, completed_at, updated_at, created_at, task_definition_id, completion_data, lawyer_notes, legal_result'
    : 'id, task_type, task_status, assigned_to, assigned_at, accepted_at, completed_at, updated_at, created_at, task_definition_id'

  const [{ data: debtor }, { data: tasks }] = await Promise.all([
    supabase.from('debtors').select('current_task_id').eq('id', debtorId).single(),
    supabase
      .from('tasks')
      .select(selectCols)
      .eq('debtor_id', debtorId)
      .order('created_at', { ascending: false }),
  ])

  const currentTaskId = debtor?.current_task_id ?? null
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
  const taskIds = taskList.map(t => t.id)

  const lawyerIds = [...new Set(taskList.map(t => t.assigned_to).filter(Boolean))] as string[]
  const defIds = [...new Set(taskList.map(t => t.task_definition_id).filter(Boolean))] as string[]

  const queries: PromiseLike<{ data: unknown }>[] = [
    lawyerIds.length > 0
      ? supabase.from('profiles').select('id, full_name').in('id', lawyerIds)
      : Promise.resolve({ data: [] }),
    defIds.length > 0
      ? supabase.from('task_definitions').select('id, label').in('id', defIds)
      : Promise.resolve({ data: [] }),
  ]

  if (fullArchive && taskIds.length > 0) {
    queries.push(
      supabase
        .from('task_attachments')
        .select('id, task_id, file_name, description')
        .in('task_id', taskIds)
        .order('created_at', { ascending: false }),
    )
  }

  const results = await Promise.all(queries)
  const lawyers = (results[0].data ?? []) as { id: string; full_name: string }[]
  const defs = (results[1].data ?? []) as { id: string; label: string }[]
  const allAttachments = fullArchive && results[2]
    ? (results[2].data ?? []) as { id: string; task_id: string; file_name: string; description: string | null }[]
    : []

  const lawyerMap = new Map(lawyers.map(l => [l.id, l.full_name]))
  const defMap = new Map(defs.map(d => [d.id, d.label]))
  const attByTask = new Map<string, typeof allAttachments>()
  for (const att of allAttachments) {
    const list = attByTask.get(att.task_id) ?? []
    list.push(att)
    attByTask.set(att.task_id, list)
  }

  const rows: TaskRow[] = taskList
    .map(t => ({
      id: t.id,
      label: taskName(t, defMap),
      lawyerName: lawyerLabel(t.assigned_to, lawyerMap),
      task_status: t.task_status,
      assignedAt: t.assigned_at ?? t.accepted_at ?? null,
      completedAt: completionDate(t),
      approvedAt: approvalDate(t),
      isCurrent: !!currentTaskId && t.id === currentTaskId,
      completionData: fullArchive ? ((t as { completion_data?: Record<string, string> | null }).completion_data ?? null) : null,
      attachments: fullArchive ? (attByTask.get(t.id) ?? []) : [],
    }))
    .sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      return 0
    })

  return (
    <Card>
      <CardHeader title={`سجل المهام (${rows.length})`} />
      {rows.length === 0 ? (
        <div className="py-10 text-center text-[#767676] text-sm">لا توجد مهام مسجّلة لهذا المدين</div>
      ) : (
        <div className="divide-y divide-[rgba(118,118,118,0.08)]">
          {rows.map(row => (
            <div key={row.id} className={`px-5 py-4 ${row.isCurrent ? 'bg-[#2C8780]/5' : ''}`}>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-[#231F20]">{row.label}</p>
                    {row.isCurrent ? (
                      <span className="text-[9px] font-bold text-white bg-[#2C8780] rounded px-1.5 py-0.5">المهمة الحالية</span>
                    ) : (
                      <span className="text-[9px] font-bold text-[#767676] bg-slate-100 rounded px-1.5 py-0.5">مهمة سابقة</span>
                    )}
                  </div>
                  <p className="text-xs text-[#767676] mt-1">
                    المحامي: <span className="font-semibold text-[#231F20]">{row.lawyerName}</span>
                  </p>
                </div>
                <Badge variant={STATUS_BADGE[row.task_status as TaskStatus] ?? 'default'}>
                  {TASK_STATUS_LABELS[row.task_status as TaskStatus] ?? row.task_status}
                </Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs">
                <div>
                  <span className="text-[#767676] block mb-0.5">تاريخ التكليف</span>
                  <span className="font-mono text-[#231F20] font-semibold" dir="ltr">{formatDate(row.assignedAt)}</span>
                </div>
                <div>
                  <span className="text-[#767676] block mb-0.5">تاريخ الإنجاز</span>
                  <span className="font-mono text-[#231F20] font-semibold" dir="ltr">{formatDate(row.completedAt)}</span>
                </div>
                <div>
                  <span className="text-[#767676] block mb-0.5">تاريخ الاعتماد</span>
                  <span className="font-mono text-[#231F20] font-semibold" dir="ltr">{formatDate(row.approvedAt)}</span>
                </div>
              </div>

              {fullArchive && row.completionData && Object.keys(row.completionData).length > 0 && (
                <CompletionFields data={row.completionData} />
              )}

              {fullArchive && row.attachments.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[rgba(118,118,118,0.08)]">
                  <p className="text-[10px] font-bold text-[#767676] mb-2">مرفقات المهمة ({row.attachments.length})</p>
                  <div className="flex flex-wrap gap-2">
                    {row.attachments.map(att => (
                      <span key={att.id} className="text-xs bg-slate-100 text-[#231F20] px-2 py-1 rounded-lg">
                        {att.file_name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
