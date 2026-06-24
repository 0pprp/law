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

/** Sum lawyer wallet balance from transactions. */
export async function fetchLawyerWalletBalance(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<number> {
  const { data } = await supabase
    .from('lawyer_wallet_transactions')
    .select('amount')
    .eq('lawyer_id', lawyerId)

  return (data ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
}

async function approvePendingReceiptsOnly(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
) {
  const { data: receipts } = await supabase
    .from('task_payment_receipts')
    .select('id')
    .eq('task_id', taskId)
    .eq('status', 'pending')

  for (const receipt of receipts ?? []) {
    await supabase
      .from('task_payment_receipts')
      .update({
        status: 'approved',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', receipt.id)
  }
}

/**
 * Credit lawyer wallet on task approval (next task or closed case).
 * Idempotent: one approved_task_payment per task + lawyer.
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

  const lawyerId = task.assigned_to
  if (!lawyerId) {
    return { ok: false, amount: 0, error: 'المهمة غير مكلفة لمحامٍ' }
  }

  if (task.fee_status === 'released' || task.fee_status === 'paid') {
    await approvePendingReceiptsOnly(supabase, taskId, reviewerId)
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
    await approvePendingReceiptsOnly(supabase, taskId, reviewerId)
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
  await approvePendingReceiptsOnly(supabase, taskId, reviewerId)

  return { ok: true, amount }
}

/** @deprecated Use releaseLawyerFee — kept for compatibility */
export async function releaseTaskFees(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
) {
  await releaseLawyerFee(supabase, taskId, reviewerId)
}
