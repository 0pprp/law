import type { SupabaseClient } from '@supabase/supabase-js'
import { batchBackfillDebtorCurrentTasks } from '@/lib/debtor-current-task'
import { autoAcceptExpiredAssignments } from '@/lib/task-assignment'

/** bump when auto-accept / backfill rules change so sessions re-run */
const SESSION_PREFIX = 'qalat_maint_v2:'

function maintenanceKey(branchId: string): string {
  return `${SESSION_PREFIX}${branchId}`
}

function alreadyRan(branchId: string): boolean {
  if (typeof sessionStorage === 'undefined') return false
  return sessionStorage.getItem(maintenanceKey(branchId)) === '1'
}

function markRan(branchId: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(maintenanceKey(branchId), '1')
}

/**
 * Backfill + auto-accept — once per branch per browser session, never blocks UI.
 */
export function scheduleBranchMaintenance(
  supabase: SupabaseClient,
  branchId: string | null,
): void {
  if (!branchId || alreadyRan(branchId)) return

  void (async () => {
    try {
      const { data: staleDebtors } = await supabase
        .from('debtors')
        .select('id')
        .eq('branch_id', branchId)
        .not('case_status', 'eq', 'closed')
        .is('current_task_id', null)
        .limit(50)

      await Promise.all([
        batchBackfillDebtorCurrentTasks(supabase, (staleDebtors ?? []).map(d => d.id)),
        autoAcceptExpiredAssignments(supabase, { branchId }),
      ])
      markRan(branchId)
    } catch (e) {
      console.warn('[scheduleBranchMaintenance]', e)
    }
  })()
}
