/**
 * Internal debtor hard-delete / create-rollback helpers.
 * Not for general user-facing delete features.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCriminalDebtorDetails } from '@/lib/criminal-debtor-details'

export type DebtorDeleteBlockReason =
  | 'payments'
  | 'tasks'
  | 'attachments'
  | 'expenses'
  | 'wallet'
  | 'not_found'

export async function assertDebtorSafeToHardDelete(
  admin: SupabaseClient,
  debtorId: string,
): Promise<{ ok: true } | { ok: false; reason: DebtorDeleteBlockReason }> {
  const { data: debtor } = await admin
    .from('debtors')
    .select('id')
    .eq('id', debtorId)
    .maybeSingle()
  if (!debtor) return { ok: false, reason: 'not_found' }

  const { count: payCount } = await admin
    .from('debtor_payments')
    .select('id', { count: 'exact', head: true })
    .eq('debtor_id', debtorId)
  if ((payCount ?? 0) > 0) return { ok: false, reason: 'payments' }

  const { count: taskCount } = await admin
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('debtor_id', debtorId)
  if ((taskCount ?? 0) > 0) return { ok: false, reason: 'tasks' }

  const { count: attCount } = await admin
    .from('debtor_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('debtor_id', debtorId)
  if ((attCount ?? 0) > 0) return { ok: false, reason: 'attachments' }

  const { count: expCount } = await admin
    .from('expenses')
    .select('id', { count: 'exact', head: true })
    .eq('debtor_id', debtorId)
  if ((expCount ?? 0) > 0) return { ok: false, reason: 'expenses' }

  return { ok: true }
}

/**
 * Cleanup after a failed create within the same request.
 * Caller must already have authenticated and authorized the create.
 * Removes storage paths then the debtor row (cascade details).
 */
export async function cleanupFailedDebtorCreate(
  admin: SupabaseClient,
  debtorId: string,
  opts?: { caseType?: string | null; alsoDeleteTaskIds?: string[] },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (opts?.alsoDeleteTaskIds?.length) {
    const { error: taskErr } = await admin.from('tasks').delete().in('id', opts.alsoDeleteTaskIds)
    if (taskErr) return { ok: false, error: taskErr.message }
  }

  if (opts?.caseType === 'criminal') {
    const details = await fetchCriminalDebtorDetails(admin, debtorId)
    const paths = [
      details?.documents_contract_file_path,
      details?.petition_file_path,
    ].filter((p): p is string => Boolean(p && p.trim()))
    if (paths.length) {
      await admin.storage.from('debtor-files').remove(paths).catch(() => null)
    }
  }

  const { error: delErr } = await admin.from('debtors').delete().eq('id', debtorId)
  if (delErr) return { ok: false, error: delErr.message }
  return { ok: true }
}
