import type { SupabaseClient } from '@supabase/supabase-js'

export const ACTIVE_CASE_BLOCK_MSG =
  'لا يمكن إضافة مهمة جديدة قبل إنهاء أو نقل المهمة الحالية'

export function isDebtorCaseClosed(caseStatus: string | null | undefined): boolean {
  return caseStatus === 'closed'
}

/** True when debtor has an active case with a current task pointer. */
export function hasActiveCurrentTask(debtor: {
  case_status?: string | null
  current_task_id?: string | null
}): boolean {
  return !isDebtorCaseClosed(debtor.case_status) && !!debtor.current_task_id
}

/**
 * Batch backfill current_task_id for multiple debtors in 2 queries instead of 3N.
 * Only handles debtors where current_task_id IS NULL (the common stale case).
 */
export async function batchBackfillDebtorCurrentTasks(
  supabase: SupabaseClient,
  debtorIds: string[],
): Promise<void> {
  if (!debtorIds.length) return

  // One query to get the latest active task for each debtor
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, debtor_id, created_at')
    .in('debtor_id', debtorIds)
    .not('task_status', 'in', '(approved,completed,closed,failed)')
    .order('created_at', { ascending: false })

  // Build map: debtor_id → latest active task id
  const latestTask = new Map<string, string | null>()
  for (const id of debtorIds) latestTask.set(id, null)
  for (const t of tasks ?? []) {
    if (!latestTask.get(t.debtor_id)) latestTask.set(t.debtor_id, t.id)
  }

  // Batch update all debtors in parallel (one update per debtor)
  await Promise.all(
    Array.from(latestTask.entries()).map(([debtorId, taskId]) =>
      supabase.from('debtors').update({ current_task_id: taskId }).eq('id', debtorId),
    ),
  )
}

/** Backfill current_task_id for one debtor when missing or pointing at a terminal task. */
export async function backfillDebtorCurrentTask(
  supabase: SupabaseClient,
  debtorId: string,
): Promise<void> {
  const { data: debtor } = await supabase
    .from('debtors')
    .select('id, case_status, current_task_id')
    .eq('id', debtorId)
    .single()

  if (!debtor || isDebtorCaseClosed(debtor.case_status)) {
    if (debtor?.current_task_id) {
      await supabase.from('debtors').update({ current_task_id: null }).eq('id', debtorId)
    }
    return
  }

  if (debtor.current_task_id) {
    const { data: current } = await supabase
      .from('tasks')
      .select('id, task_status')
      .eq('id', debtor.current_task_id)
      .maybeSingle()

    const terminal = ['approved', 'completed', 'closed']
    if (current && !terminal.includes(current.task_status)) return
  }

  const { data: latest } = await supabase
    .from('tasks')
    .select('id')
    .eq('debtor_id', debtorId)
    .not('task_status', 'in', '(approved,completed,closed)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  await supabase
    .from('debtors')
    .update({ current_task_id: latest?.id ?? null })
    .eq('id', debtorId)
}
