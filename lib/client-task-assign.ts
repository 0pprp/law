import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity-log'
import { assignTasksViaApi, unassignTasksViaApi } from '@/lib/task-operations-api'
import { PERMISSION_DENIED_MSG } from '@/lib/permissions'
import { fmtDate } from '@/lib/utils'
import { cacheDelete, cacheInvalidatePrefix } from '@/lib/query-cache'

export interface AssignmentTaskRef {
  id: string
  created_at: string
}

export function validateTaskAssignmentInput(
  canAssign: boolean,
  taskIds: string[],
  lawyerId: string,
  dueDate: string,
  tasks: AssignmentTaskRef[],
): string | null {
  if (!canAssign) return PERMISSION_DENIED_MSG
  if (!lawyerId) return 'اختر محامياً'
  if (!dueDate) return 'حدد تاريخ نهاية التكليف'
  if (taskIds.length === 0) return 'حدد مهمة واحدة على الأقل'
  for (const id of taskIds) {
    const task = tasks.find(t => t.id === id)
    if (!task) continue
    const min = task.created_at.split('T')[0]
    if (dueDate < min) {
      return `تاريخ نهاية التكليف يجب أن يكون من ${fmtDate(min)} فما بعد (تاريخ إنشاء المهمة)`
    }
  }
  return null
}

export function invalidateAssignmentCaches(branchId: string | null, taskView?: string, filterDef?: string, filterListId?: string, debouncedSearch?: string) {
  const branchKey = branchId ?? 'all'
  cacheDelete(`dashboard:${branchKey}`)
  cacheInvalidatePrefix('dashboard:')
  cacheInvalidatePrefix('tasks:assign:')
  cacheInvalidatePrefix('tasks:review:')
  if (taskView) {
    cacheDelete(`tasks:assign:${branchKey}:${taskView}:${filterDef ?? ''}:${filterListId ?? ''}:${debouncedSearch ?? ''}:0`)
  }
  cacheDelete(`tasks:assign:${branchKey}:overdue:${filterDef ?? ''}:${filterListId ?? ''}:${debouncedSearch ?? ''}:0`)
  cacheDelete(`tasks:assign:${branchKey}:assigned:${filterDef ?? ''}:${filterListId ?? ''}:${debouncedSearch ?? ''}:0`)
  cacheDelete(`tasks:assign:${branchKey}:waiting:${filterDef ?? ''}:${filterListId ?? ''}:${debouncedSearch ?? ''}:0`)
}

export async function executeTaskAssignment(params: {
  taskIds: string[]
  lawyerId: string
  dueDate: string
  assigneeOptions: { id: string; full_name: string }[]
  lawyers: { id: string; full_name: string }[]
  delegates: { id: string; full_name: string }[]
  branchId: string | null
  taskView?: string
  filterDef?: string
  filterListId?: string
  debouncedSearch?: string
  caseType?: 'civil' | 'criminal' | null
}): Promise<{ ok: boolean; error: string | null }> {
  const result = await assignTasksViaApi(params.taskIds, params.lawyerId, params.dueDate)
  if (!result.ok) return result

  const lawyerName = params.assigneeOptions.find(l => l.id === params.lawyerId)?.full_name
    ?? params.lawyers.find(l => l.id === params.lawyerId)?.full_name
    ?? params.delegates.find(d => d.id === params.lawyerId)?.full_name
    ?? '—'
  const isDelegate = params.delegates.some(d => d.id === params.lawyerId)

  const supabase = createClient()
  await logActivity({
    action: 'bulk_assign_tasks',
    entity_type: 'task',
    entity_id: params.taskIds[0],
    description: isDelegate
      ? `تكليف ${params.taskIds.length} مهمة للمندوب ${lawyerName}`
      : `تكليف ${params.taskIds.length} مهمة للمحامي ${lawyerName}`,
    case_type: params.caseType === 'criminal' ? 'criminal' : 'civil',
  }, supabase)

  invalidateAssignmentCaches(
    params.branchId,
    params.taskView,
    params.filterDef,
    params.filterListId,
    params.debouncedSearch,
  )

  return { ok: true, error: null }
}

export async function executeTaskUnassign(params: {
  taskIds: string[]
  reason?: string | null
  branchId: string | null
  taskView?: string
  filterDef?: string
  filterListId?: string
  debouncedSearch?: string
  caseType?: 'civil' | 'criminal' | null
  canAssign: boolean
}): Promise<{ ok: boolean; error: string | null }> {
  if (!params.canAssign) return { ok: false, error: PERMISSION_DENIED_MSG }
  if (!params.taskIds.length) return { ok: false, error: 'حدد مهمة واحدة على الأقل' }

  const result = await unassignTasksViaApi(params.taskIds, params.reason)
  if (!result.ok) return { ok: false, error: result.error }

  const supabase = createClient()
  await logActivity({
    action: 'bulk_unassign_tasks',
    entity_type: 'task',
    entity_id: params.taskIds[0],
    description: `إلغاء تكليف ${params.taskIds.length} مهمة — عادت بانتظار التكليف`,
    case_type: params.caseType === 'criminal' ? 'criminal' : 'civil',
  }, supabase)

  invalidateAssignmentCaches(
    params.branchId,
    params.taskView,
    params.filterDef,
    params.filterListId,
    params.debouncedSearch,
  )

  return { ok: true, error: null }
}
