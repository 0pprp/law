import type { SupabaseClient } from '@supabase/supabase-js'

export function parseGps(val: string): { lat: number; lng: number } | null {
  if (!val) return null
  const parts = val.split(',').map(s => parseFloat(s.trim()))
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    if (parts[0] >= -90 && parts[0] <= 90 && parts[1] >= -180 && parts[1] <= 180) {
      return { lat: parts[0], lng: parts[1] }
    }
  }
  return null
}

export function extractGpsFromCompletion(
  completionData: Record<string, string> | null | undefined,
  gpsKeys: string[],
): { lat: number; lng: number } | null {
  if (!completionData || !gpsKeys.length) return null
  for (const key of gpsKeys) {
    const parsed = parseGps(completionData[key])
    if (parsed) return parsed
  }
  return null
}

/** Wallet balance via SQL aggregate — avoids fetching all rows. */
export async function fetchLawyerWalletBalance(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<number> {
  const { fetchLawyerWalletBalance: getBalance } = await import('@/lib/lawyer-wallet')
  return getBalance(supabase, lawyerId)
}

/**
 * Credit lawyer wallet when the case advances (next task assigned) or closes.
 * Idempotent: fee_status + one approved_task_payment per task + lawyer.
 */
export async function releaseLawyerFee(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
): Promise<{ ok: boolean; amount: number; error?: string }> {
  const { data: task, error: taskErr } = await supabase
    .from('tasks')
    .select(`
      id,
      assigned_to,
      reward_amount,
      fee_status,
      task_status,
      task_definition_id,
      task_type,
      debtor_id,
      branch_id,
      task_definitions(fee_amount, label)
    `)
    .eq('id', taskId)
    .single()

  if (taskErr || !task) {
    return { ok: false, amount: 0, error: taskErr?.message ?? 'المهمة غير موجودة' }
  }

  if (task.task_status !== 'approved') {
    return { ok: false, amount: 0, error: 'لا تُصرف الأتعاب إلا بعد اعتماد المهمة' }
  }

  const lawyerId = task.assigned_to
  if (!lawyerId) {
    return { ok: false, amount: 0, error: 'المهمة غير مكلفة لمحامٍ' }
  }

  if (task.fee_status === 'released' || task.fee_status === 'paid') {
    return { ok: true, amount: 0 }
  }

  const { data: existingTx } = await supabase
    .from('lawyer_wallet_transactions')
    .select('id')
    .eq('lawyer_id', lawyerId)
    .eq('reference_id', taskId)
    .eq('type', 'approved_task_payment')
    .maybeSingle()

  if (existingTx) {
    await supabase.from('tasks').update({ fee_status: 'released' } as any).eq('id', taskId)
    return { ok: true, amount: 0 }
  }

  const def = task.task_definitions as { fee_amount?: number; label?: string } | null
  const amount = Number(task.reward_amount) > 0
    ? Number(task.reward_amount)
    : Number(def?.fee_amount ?? 0)

  const taskLabel = def?.label ?? task.task_type ?? 'مهمة'

  if (amount > 0) {
    const { error: walletErr } = await supabase.from('lawyer_wallet_transactions').insert({
      lawyer_id: lawyerId,
      type: 'approved_task_payment',
      amount,
      notes: `أتعاب مهمة: ${taskLabel}`,
      reference_id: taskId,
      created_by: reviewerId,
    })

    if (walletErr) {
      console.error('[releaseLawyerFee] wallet insert:', walletErr)
      return { ok: false, amount: 0, error: walletErr.message }
    }
  }

  await supabase.from('tasks').update({ fee_status: 'released' } as any).eq('id', taskId)

  return { ok: true, amount }
}

/** Release fees for the approved task that preceded this assignment (same debtor). */
export async function releasePreviousTaskFeeOnAssignment(
  supabase: SupabaseClient,
  debtorId: string,
  assigningTaskId: string,
  releasedBy: string,
): Promise<{ ok: boolean; amount: number; error?: string }> {
  const { data: debtor } = await supabase
    .from('debtors')
    .select('last_task_id')
    .eq('id', debtorId)
    .single()

  let previousTaskId = (debtor?.last_task_id as string | null) ?? null
  if (previousTaskId === assigningTaskId) previousTaskId = null

  if (!previousTaskId) {
    const { data: candidates } = await supabase
      .from('tasks')
      .select('id, fee_status, completed_at')
      .eq('debtor_id', debtorId)
      .eq('task_status', 'approved')
      .neq('id', assigningTaskId)
      .order('completed_at', { ascending: false })
      .limit(5)

    const prev = (candidates ?? []).find(
      t => t.fee_status !== 'released' && t.fee_status !== 'paid',
    )
    previousTaskId = prev?.id ?? null
  }

  if (!previousTaskId) {
    return { ok: true, amount: 0 }
  }

  return releaseLawyerFee(supabase, previousTaskId, releasedBy)
}

export async function releasePreviousTaskFeesOnAssignment(
  supabase: SupabaseClient,
  assignedTaskIds: string[],
  releasedBy: string,
): Promise<{ ok: boolean; error: string | null }> {
  if (!assignedTaskIds.length) return { ok: true, error: null }

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, debtor_id')
    .in('id', assignedTaskIds)

  const debtorToAssigningTask = new Map<string, string>()
  for (const t of tasks ?? []) {
    if (!debtorToAssigningTask.has(t.debtor_id)) {
      debtorToAssigningTask.set(t.debtor_id, t.id)
    }
  }

  for (const [debtorId, taskId] of debtorToAssigningTask) {
    const result = await releasePreviousTaskFeeOnAssignment(supabase, debtorId, taskId, releasedBy)
    if (!result.ok) {
      return { ok: false, error: result.error ?? 'فشل صرف أتعاب المهمة السابقة' }
    }
  }

  return { ok: true, error: null }
}

/** @deprecated Use releaseLawyerFee — kept for compatibility */
export async function releaseTaskFees(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
) {
  await releaseLawyerFee(supabase, taskId, reviewerId)
}
