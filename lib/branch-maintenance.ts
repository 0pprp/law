import type { SupabaseClient } from '@supabase/supabase-js'
import { batchBackfillDebtorCurrentTasks } from '@/lib/debtor-current-task'

/** bump when auto-accept / backfill rules change so sessions re-run */
const SESSION_PREFIX = 'qalat_maint_v3:'
const AUTO_ACCEPT_ALL_KEY = `${SESSION_PREFIX}auto_accept_all`

function maintenanceKey(branchId: string): string {
  return `${SESSION_PREFIX}${branchId}`
}

function alreadyRan(key: string): boolean {
  if (typeof sessionStorage === 'undefined') return false
  return sessionStorage.getItem(key) === '1'
}

function markRan(key: string): void {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(key, '1')
}

/** موافقة تلقائية لكل الفروع — مرة واحدة لكل جلسة متصفح */
export async function ensureAutoAcceptAllAssignments(): Promise<number> {
  if (alreadyRan(AUTO_ACCEPT_ALL_KEY)) return 0
  try {
    const res = await fetch('/api/admin/auto-accept-assignments', { method: 'POST' })
    if (!res.ok) return 0
    markRan(AUTO_ACCEPT_ALL_KEY)
    const body = await res.json().catch(() => ({}))
    return typeof body?.accepted === 'number' ? body.accepted : 0
  } catch (e) {
    console.warn('[ensureAutoAcceptAllAssignments]', e)
    return 0
  }
}

/**
 * Backfill (current branch) + auto-accept (all branches via service role).
 * Once per browser session, never blocks UI.
 */
export function scheduleBranchMaintenance(
  supabase: SupabaseClient,
  branchId: string | null,
): void {
  void ensureAutoAcceptAllAssignments()

  if (!branchId || alreadyRan(maintenanceKey(branchId))) return

  void (async () => {
    try {
      const { data: staleDebtors } = await supabase
        .from('debtors')
        .select('id')
        .eq('branch_id', branchId)
        .not('case_status', 'eq', 'closed')
        .is('current_task_id', null)
        .limit(50)

      await batchBackfillDebtorCurrentTasks(supabase, (staleDebtors ?? []).map(d => d.id))
      markRan(maintenanceKey(branchId))
    } catch (e) {
      console.warn('[scheduleBranchMaintenance:backfill]', e)
    }
  })()
}
