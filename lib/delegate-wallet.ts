import type { SupabaseClient } from '@supabase/supabase-js'
import {
  DELEGATE_ADDRESS_FEE,
  isFindAddressTaskType,
  normalizeDebtorNotified,
  normalizeDelegateFeeStatus,
  type DebtorNotifiedStatus,
  type DelegateFeeStatus,
} from '@/lib/delegate'

async function ensureWallet(supabase: SupabaseClient, delegateId: string) {
  await supabase.from('delegate_wallets').upsert(
    { delegate_id: delegateId },
    { onConflict: 'delegate_id', ignoreDuplicates: true },
  )
}

export async function fetchDelegateWallet(
  supabase: SupabaseClient,
  delegateId: string,
): Promise<{ pending_balance: number; available_balance: number; total_withdrawn: number }> {
  await ensureWallet(supabase, delegateId)
  const { data } = await supabase
    .from('delegate_wallets')
    .select('pending_balance, available_balance, total_withdrawn')
    .eq('delegate_id', delegateId)
    .maybeSingle()
  return {
    pending_balance: Number(data?.pending_balance ?? 0),
    available_balance: Number(data?.available_balance ?? 0),
    total_withdrawn: Number(data?.total_withdrawn ?? 0),
  }
}

export async function fetchDelegateWalletTransactions(
  supabase: SupabaseClient,
  delegateId: string,
  limit = 100,
) {
  const { data, error } = await supabase
    .from('delegate_wallet_transactions')
    .select('*')
    .eq('delegate_id', delegateId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    console.error('[fetchDelegateWalletTransactions]', error.message)
    return []
  }
  return data ?? []
}

export async function creditDelegateAddressFeePending(
  supabase: SupabaseClient,
  taskId: string,
  reviewerId: string,
): Promise<{ ok: boolean; amount: number; error?: string; skipped?: boolean }> {
  const { data: task, error } = await supabase
    .from('tasks')
    .select(`
      id, assigned_to, task_status, task_type, task_definition_id, debtor_id, branch_id,
      delegate_fee_status, debtor_notified,
      task_definitions(task_type, label)
    `)
    .eq('id', taskId)
    .single()

  if (error || !task) {
    return { ok: false, amount: 0, error: error?.message ?? 'المهمة غير موجودة' }
  }

  const defType = Array.isArray(task.task_definitions)
    ? (task.task_definitions[0] as { task_type?: string } | undefined)?.task_type
    : (task.task_definitions as { task_type?: string } | null)?.task_type

  const taskType = (task.task_type as string | null) ?? defType ?? null
  if (!isFindAddressTaskType(taskType)) {
    return { ok: true, amount: 0, skipped: true }
  }

  const delegateId = task.assigned_to as string | null
  if (!delegateId) return { ok: true, amount: 0, skipped: true }

  const { data: assignee } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', delegateId)
    .single()

  if (assignee?.role !== 'delegate') {
    return { ok: true, amount: 0, skipped: true }
  }

  const feeStatus = normalizeDelegateFeeStatus(task.delegate_fee_status as string)
  if (feeStatus !== 'none') {
    return { ok: true, amount: 0, skipped: true }
  }

  const amount = DELEGATE_ADDRESS_FEE
  await ensureWallet(supabase, delegateId)

  const { error: txErr } = await supabase.from('delegate_wallet_transactions').insert({
    delegate_id: delegateId,
    type: 'delegate_address_fee_pending',
    amount,
    task_id: taskId,
    notes: 'أتعاب معلقة لمهمة إيجاد عنوان',
    created_by: reviewerId,
  })

  if (txErr) {
    if (txErr.message?.includes('idx_delegate_fee_pending_once') || txErr.code === '23505') {
      return { ok: true, amount: 0, skipped: true }
    }
    return { ok: false, amount: 0, error: txErr.message }
  }

  const wallet = await fetchDelegateWallet(supabase, delegateId)
  const { error: wErr } = await supabase
    .from('delegate_wallets')
    .update({
      pending_balance: wallet.pending_balance + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('delegate_id', delegateId)

  if (wErr) return { ok: false, amount: 0, error: wErr.message }

  await supabase
    .from('tasks')
    .update({
      delegate_fee_status: 'pending',
      debtor_notified: 'unset',
      reward_amount: amount,
    } as any)
    .eq('id', taskId)

  return { ok: true, amount }
}

export async function setDebtorNotifiedStatus(
  supabase: SupabaseClient,
  taskId: string,
  next: DebtorNotifiedStatus,
  actorId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: task, error } = await supabase
    .from('tasks')
    .select('id, assigned_to, debtor_notified, delegate_fee_status')
    .eq('id', taskId)
    .single()

  if (error || !task) return { ok: false, error: error?.message ?? 'المهمة غير موجودة' }

  const prev = normalizeDebtorNotified(task.debtor_notified as string)
  if (prev === next) return { ok: true }

  const feeStatus = normalizeDelegateFeeStatus(task.delegate_fee_status as string)
  const delegateId = task.assigned_to as string | null
  if (!delegateId) return { ok: false, error: 'المهمة غير مكلّفة لمندوب' }

  if (feeStatus === 'withdrawn') {
    return { ok: false, error: 'لا يمكن تغيير حالة التبليغ لأن الأتعاب تم صرفها.' }
  }

  if (feeStatus === 'none') {
    await supabase.from('tasks').update({ debtor_notified: next } as any).eq('id', taskId)
    return { ok: true }
  }

  await ensureWallet(supabase, delegateId)
  const wallet = await fetchDelegateWallet(supabase, delegateId)
  const amount = DELEGATE_ADDRESS_FEE

  if (next === 'yes' && prev !== 'yes') {
    if (feeStatus !== 'pending') {
      await supabase.from('tasks').update({ debtor_notified: next } as any).eq('id', taskId)
      return { ok: true }
    }
    if (wallet.pending_balance < amount) {
      return { ok: false, error: 'الرصيد المعلق غير كافٍ للتحويل' }
    }
    const { error: txErr } = await supabase.from('delegate_wallet_transactions').insert({
      delegate_id: delegateId,
      type: 'delegate_fee_released',
      amount,
      task_id: taskId,
      notes: 'تحويل أتعاب المندوب إلى قابلة للصرف بعد تبليغ المدين',
      created_by: actorId,
    })
    if (txErr) return { ok: false, error: txErr.message }

    const { error: wErr } = await supabase
      .from('delegate_wallets')
      .update({
        pending_balance: wallet.pending_balance - amount,
        available_balance: wallet.available_balance + amount,
        updated_at: new Date().toISOString(),
      })
      .eq('delegate_id', delegateId)
    if (wErr) return { ok: false, error: wErr.message }

    await supabase
      .from('tasks')
      .update({ debtor_notified: 'yes', delegate_fee_status: 'available' } as any)
      .eq('id', taskId)
    return { ok: true }
  }

  if (prev === 'yes' && next !== 'yes') {
    if (feeStatus !== 'available') {
      await supabase.from('tasks').update({ debtor_notified: next } as any).eq('id', taskId)
      return { ok: true }
    }
    if (wallet.available_balance < amount) {
      return { ok: false, error: 'لا يمكن تغيير حالة التبليغ لأن الأتعاب تم صرفها.' }
    }
    const { error: txErr } = await supabase.from('delegate_wallet_transactions').insert({
      delegate_id: delegateId,
      type: 'delegate_fee_rehold',
      amount,
      task_id: taskId,
      notes: 'إعادة أتعاب المندوب إلى الرصيد المعلق بعد إلغاء التبليغ',
      created_by: actorId,
    })
    if (txErr) return { ok: false, error: txErr.message }

    const { error: wErr } = await supabase
      .from('delegate_wallets')
      .update({
        pending_balance: wallet.pending_balance + amount,
        available_balance: wallet.available_balance - amount,
        updated_at: new Date().toISOString(),
      })
      .eq('delegate_id', delegateId)
    if (wErr) return { ok: false, error: wErr.message }

    await supabase
      .from('tasks')
      .update({ debtor_notified: next, delegate_fee_status: 'pending' } as any)
      .eq('id', taskId)
    return { ok: true }
  }

  await supabase.from('tasks').update({ debtor_notified: next } as any).eq('id', taskId)
  return { ok: true }
}

export async function withdrawDelegateAvailable(
  supabase: SupabaseClient,
  delegateId: string,
  amount: number,
  actorId: string,
  notes?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'المبلغ غير صالح' }
  }

  await ensureWallet(supabase, delegateId)
  const wallet = await fetchDelegateWallet(supabase, delegateId)
  if (amount > wallet.available_balance) {
    return { ok: false, error: 'لا يمكن السحب بأكثر من الرصيد القابل للصرف' }
  }

  const { error: txErr } = await supabase.from('delegate_wallet_transactions').insert({
    delegate_id: delegateId,
    type: 'delegate_wallet_withdrawal',
    amount: -amount,
    notes: notes?.trim() || 'سحب من رصيد المندوب القابل للصرف',
    created_by: actorId,
  })
  if (txErr) return { ok: false, error: txErr.message }

  const { error: wErr } = await supabase
    .from('delegate_wallets')
    .update({
      available_balance: wallet.available_balance - amount,
      total_withdrawn: wallet.total_withdrawn + amount,
      updated_at: new Date().toISOString(),
    })
    .eq('delegate_id', delegateId)

  if (wErr) return { ok: false, error: wErr.message }

  await markDelegateTasksWithdrawnForAmount(supabase, delegateId, amount)
  return { ok: true }
}

export interface DelegateReportRow {
  task_id: string
  delegate_id: string
  delegate_name: string
  branch_id: string | null
  branch_name: string
  debtor_id: string | null
  debtor_name: string
  debtor_list_name: string
  task_label: string
  completed_at: string | null
  debtor_notified: DebtorNotifiedStatus
  fee_amount: number
  fee_status: DelegateFeeStatus
  withdrawn_at: string | null
}

export async function fetchDelegateReport(
  supabase: SupabaseClient,
  branchId?: string | null,
): Promise<DelegateReportRow[]> {
  // بدون embeds: علاقة tasks↔debtors مزدوجة وتكسر PostgREST أحياناً
  let q = supabase
    .from('tasks')
    .select(`
      id, assigned_to, branch_id, debtor_id, completed_at, created_at,
      debtor_notified, delegate_fee_status, reward_amount, task_type,
      task_definition_id
    `)
    .in('delegate_fee_status', ['pending', 'available', 'withdrawn'])
    .not('assigned_to', 'is', null)
    .order('completed_at', { ascending: false })

  if (branchId) q = q.eq('branch_id', branchId)

  const { data: tasks, error } = await q
  if (error) {
    console.error('[fetchDelegateReport]', error.message)
    return []
  }
  if (!tasks?.length) return []

  const assigneeIds = [...new Set(tasks.map(t => t.assigned_to).filter(Boolean))] as string[]
  const debtorIds = [...new Set(tasks.map(t => t.debtor_id).filter(Boolean))] as string[]
  const defIds = [...new Set(tasks.map(t => t.task_definition_id).filter(Boolean))] as string[]
  const branchIds = [...new Set(tasks.map(t => t.branch_id).filter(Boolean))] as string[]
  const taskIds = tasks.map(t => t.id)

  const [
    { data: assignees },
    { data: debtors },
    { data: defs },
    { data: branches },
    { data: txs },
  ] = await Promise.all([
    assigneeIds.length
      ? supabase.from('profiles').select('id, full_name, role').in('id', assigneeIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; role: string | null }[] }),
    debtorIds.length
      ? supabase.from('debtors').select('id, full_name, branch_list:branch_lists(name)').in('id', debtorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; branch_list?: { name?: string } | { name?: string }[] | null }[] }),
    defIds.length
      ? supabase.from('task_definitions').select('id, label').in('id', defIds)
      : Promise.resolve({ data: [] as { id: string; label: string }[] }),
    branchIds.length
      ? supabase.from('branches').select('id, name').in('id', branchIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    taskIds.length
      ? supabase
          .from('delegate_wallet_transactions')
          .select('task_id, created_at')
          .eq('type', 'delegate_wallet_withdrawal')
          .in('task_id', taskIds)
      : Promise.resolve({ data: [] as { task_id: string | null; created_at: string }[] }),
  ])

  const assigneeMap = new Map((assignees ?? []).map(a => [a.id, a]))
  const debtorMap = new Map((debtors ?? []).map(d => [d.id, d]))
  const defMap = new Map((defs ?? []).map(d => [d.id, d]))
  const branchMap = new Map((branches ?? []).map(b => [b.id, b.name]))
  const withdrawnAt = new Map<string, string>()
  for (const tx of txs ?? []) {
    if (tx.task_id) withdrawnAt.set(tx.task_id, tx.created_at)
  }

  function debtorListName(
    debtor: { branch_list?: { name?: string } | { name?: string }[] | null } | null | undefined,
  ): string {
    if (!debtor) return '—'
    const bl = Array.isArray(debtor.branch_list) ? debtor.branch_list[0] : debtor.branch_list
    return bl?.name?.trim() || '—'
  }

  const rows: DelegateReportRow[] = []
  for (const t of tasks) {
    const assignee = t.assigned_to ? assigneeMap.get(t.assigned_to) : null
    if (!assignee || assignee.role !== 'delegate') continue
    const debtor = t.debtor_id ? debtorMap.get(t.debtor_id) : null
    const def = t.task_definition_id ? defMap.get(t.task_definition_id) : null
    rows.push({
      task_id: t.id,
      delegate_id: assignee.id,
      delegate_name: assignee.full_name,
      branch_id: t.branch_id,
      branch_name: (t.branch_id && branchMap.get(t.branch_id)) || '—',
      debtor_id: t.debtor_id,
      debtor_name: debtor?.full_name ?? '—',
      debtor_list_name: debtorListName(debtor),
      task_label: def?.label ?? 'إيجاد عنوان',
      completed_at: t.completed_at,
      debtor_notified: normalizeDebtorNotified(t.debtor_notified),
      fee_amount: Number(t.reward_amount ?? DELEGATE_ADDRESS_FEE),
      fee_status: normalizeDelegateFeeStatus(t.delegate_fee_status),
      withdrawn_at: withdrawnAt.get(t.id) ?? null,
    })
  }
  return rows
}

async function markDelegateTasksWithdrawnForAmount(
  supabase: SupabaseClient,
  delegateId: string,
  amount: number,
): Promise<void> {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, reward_amount')
    .eq('assigned_to', delegateId)
    .eq('delegate_fee_status', 'available')
    .order('completed_at', { ascending: true })

  let remaining = amount
  for (const t of tasks ?? []) {
    if (remaining <= 0) break
    const fee = Number(t.reward_amount ?? DELEGATE_ADDRESS_FEE)
    await supabase.from('tasks').update({ delegate_fee_status: 'withdrawn' } as any).eq('id', t.id)
    remaining -= fee
  }
}
