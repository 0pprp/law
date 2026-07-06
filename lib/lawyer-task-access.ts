import type { SupabaseClient } from '@supabase/supabase-js'
import { isGeneralLawyerType } from '@/lib/lawyer-type'

export type LawyerTaskAccessResult =
  | { ok: true; task: Record<string, unknown>; branchId: string | null }
  | { ok: false; reason: 'not_found' | 'unassigned' | 'closed' | 'branch' | 'rejected' }

const CLOSED_STATUSES = new Set(['closed'])

/** Lawyer may open a task only while actively assigned. Rejected assignments are not accessible. */
export async function checkLawyerTaskAccess(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<LawyerTaskAccessResult> {
  const [{ data: profile }, { data: task }] = await Promise.all([
    supabase.from('profiles').select('branch_id, lawyer_type').eq('id', userId).single(),
    supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single(),
  ])

  if (!task) return { ok: false, reason: 'not_found' }
  if (CLOSED_STATUSES.has(task.task_status)) return { ok: false, reason: 'closed' }

  if (task.assignment_rejected_by === userId && task.assigned_to !== userId) {
    return { ok: false, reason: 'rejected' }
  }

  if (task.assigned_to !== userId) return { ok: false, reason: 'unassigned' }

  const isGeneral = isGeneralLawyerType(profile?.lawyer_type)
  const lawyerBranch = profile?.branch_id ?? null
  const taskBranch = task.branch_id ?? null

  if (!isGeneral && lawyerBranch && taskBranch && lawyerBranch !== taskBranch) {
    return { ok: false, reason: 'branch' }
  }

  return { ok: true, task, branchId: taskBranch ?? lawyerBranch }
}
