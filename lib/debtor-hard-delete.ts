/**
 * حذف مدين داخلي (rollback إنشاء فاشل) + حذف تام للمدير مع كل البيانات المرتبطة.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCriminalDebtorDetails } from '@/lib/criminal-debtor-details'
import { deleteManyFromR2, r2ObjectKey } from '@/lib/r2-storage'
import { relativeStoredPath } from '@/lib/stored-file-url'

export type DebtorDeleteBlockReason =
  | 'payments'
  | 'tasks'
  | 'attachments'
  | 'expenses'
  | 'wallet'
  | 'not_found'

async function deleteQuiet(
  admin: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
): Promise<string | null> {
  if (!ids.length) return null
  const { error } = await admin.from(table).delete().in(column, ids)
  if (!error) return null
  const msg = String(error.message ?? '')
  // جدول غير موجود أو عمود غير متوافق — نتجاهل في الحذف التشغيلي
  if (msg.includes(table) || error.code === '42P01' || error.code === '42703') return null
  return msg
}

async function deleteByDebtorQuiet(
  admin: SupabaseClient,
  table: string,
  debtorId: string,
): Promise<string | null> {
  const { error } = await admin.from(table).delete().eq('debtor_id', debtorId)
  if (!error) return null
  const msg = String(error.message ?? '')
  if (msg.includes(table) || error.code === '42P01' || error.code === '42703') return null
  return msg
}

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
      await deleteManyFromR2(paths.map(p => r2ObjectKey('debtor-files', p))).catch(() => null)
    }
  }

  const { error: delErr } = await admin.from('debtors').delete().eq('id', debtorId)
  if (delErr) return { ok: false, error: delErr.message }
  return { ok: true }
}

/**
 * حذف تام للمدير: مهام + مرفقات + تسديدات + صرفيات + ملاحظات + كل ما يرتبط بالمدين.
 */
export async function hardDeleteDebtorCascade(
  admin: SupabaseClient,
  debtorId: string,
  opts?: { caseType?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  // فك إشارات المهام على صف المدين قبل حذف المهام
  await admin.from('debtors').update({
    current_task_id: null,
    last_task_id: null,
    special_status_id: null,
  } as Record<string, unknown>).eq('id', debtorId)

  const { data: tasks, error: tasksErr } = await admin
    .from('tasks')
    .select('id')
    .eq('debtor_id', debtorId)
  if (tasksErr) return { ok: false, error: tasksErr.message }
  const taskIds = (tasks ?? []).map(t => t.id).filter(Boolean)

  if (taskIds.length) {
    const { data: taskAtts } = await admin
      .from('task_attachments')
      .select('file_path')
      .in('task_id', taskIds)
    const taskPaths = (taskAtts ?? [])
      .map(a => a.file_path)
      .filter((p): p is string => Boolean(p && String(p).trim()))
      .map(p => relativeStoredPath('task-files', p))
      .filter((p): p is string => Boolean(p))
    if (taskPaths.length) {
      await deleteManyFromR2(taskPaths.map(p => r2ObjectKey('task-files', p))).catch(() => null)
    }

    for (const [table, col] of [
      ['task_attachments', 'task_id'],
      ['expenses', 'task_id'],
      ['lawyer_wallet_transactions', 'reference_id'],
      ['lawyer_stationery_transactions', 'reference_id'],
      ['delegate_wallet_transactions', 'task_id'],
    ] as const) {
      const err = await deleteQuiet(admin, table, col, taskIds)
      if (err) return { ok: false, error: `${table}: ${err}` }
    }

    // طلبات عدم الالتزام تشير للمهام — nullify ثم احذف الطلبات لاحقاً بـ debtor_id
    await admin
      .from('payment_noncompliance_requests')
      .update({ source_task_id: null, created_task_id: null })
      .in('source_task_id', taskIds)
    await admin
      .from('payment_noncompliance_requests')
      .update({ created_task_id: null })
      .in('created_task_id', taskIds)

    const { error: delTasksErr } = await admin.from('tasks').delete().in('id', taskIds)
    if (delTasksErr) return { ok: false, error: delTasksErr.message }
  }

  // مرفقات المدين من التخزين
  const { data: atts } = await admin
    .from('debtor_attachments')
    .select('file_path')
    .eq('debtor_id', debtorId)
  const attPaths = (atts ?? [])
    .map(a => a.file_path)
    .filter((p): p is string => Boolean(p && String(p).trim()))
    .map(p => relativeStoredPath('debtor-files', p))
    .filter((p): p is string => Boolean(p))
  if (attPaths.length) {
    await deleteManyFromR2(attPaths.map(p => r2ObjectKey('debtor-files', p))).catch(() => null)
  }

  const caseType = opts?.caseType === 'criminal' ? 'criminal' : 'civil'
  if (caseType === 'criminal') {
    const details = await fetchCriminalDebtorDetails(admin, debtorId)
    const paths = [
      details?.documents_contract_file_path,
      details?.petition_file_path,
    ]
      .filter((p): p is string => Boolean(p && p.trim()))
      .map(p => relativeStoredPath('debtor-files', p))
      .filter((p): p is string => Boolean(p))
    if (paths.length) {
      await deleteManyFromR2(paths.map(p => r2ObjectKey('debtor-files', p))).catch(() => null)
    }
  }

  for (const table of [
    'expenses',
    'debtor_payments',
    'debtor_notes',
    'debtor_attachments',
    'payment_noncompliance_requests',
    'criminal_debtor_details',
  ] as const) {
    const err = await deleteByDebtorQuiet(admin, table, debtorId)
    if (err) return { ok: false, error: `${table}: ${err}` }
  }

  // سجلات نشاط مرتبطة بالمدين (اختياري)
  await admin.from('activity_logs').delete().eq('entity_id', debtorId).eq('entity_type', 'debtor')

  const { error: delErr } = await admin.from('debtors').delete().eq('id', debtorId)
  if (delErr) return { ok: false, error: delErr.message }
  return { ok: true }
}
