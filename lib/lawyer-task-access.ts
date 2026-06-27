import type { SupabaseClient } from '@supabase/supabase-js'

export type LawyerTaskAccessResult =
  | { ok: true; task: Record<string, unknown>; branchId: string | null }
  | { ok: false; reason: 'not_found' | 'unassigned' | 'closed' | 'branch' }

const CLOSED_STATUSES = new Set(['closed'])

/** Lawyer may open a task only when assigned, same branch, and task is not closed. */
export async function checkLawyerTaskAccess(
  supabase: SupabaseClient,
  userId: string,
  taskId: string,
): Promise<LawyerTaskAccessResult> {
  const [{ data: profile }, { data: task }] = await Promise.all([
    supabase.from('profiles').select('branch_id').eq('id', userId).single(),
    supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single(),
  ])

  if (!task) return { ok: false, reason: 'not_found' }
  if (task.assigned_to !== userId) return { ok: false, reason: 'unassigned' }
  if (CLOSED_STATUSES.has(task.task_status)) return { ok: false, reason: 'closed' }

  const lawyerBranch = profile?.branch_id ?? null
  const taskBranch = task.branch_id ?? null
  if (lawyerBranch && taskBranch && lawyerBranch !== taskBranch) {
    return { ok: false, reason: 'branch' }
  }

  return { ok: true, task, branchId: lawyerBranch }
}
