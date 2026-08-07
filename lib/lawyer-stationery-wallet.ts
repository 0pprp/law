import type { SupabaseClient } from '@supabase/supabase-js'

export type StationeryItem = 'stamps'
export type StationeryTxType = 'deposit' | 'withdrawal' | 'lawsuit_deduction'

export const STATIONERY_ITEM_LABELS: Record<StationeryItem, string> = {
  stamps: 'الطوابع',
}

export const STATIONERY_WALLET_LABEL = 'محفظة القرطاسية'

/** خصم تلقائي عند الاعتماد النهائي لإقامة دعوى — طابع واحد */
export const LAWSUIT_STATIONERY_DEDUCT = {
  stamps: 1,
} as const

export interface StationeryBalances {
  stamps: number
}

export interface StationeryTxRow {
  id: string
  lawyer_id: string
  item: StationeryItem
  amount: number
  type: StationeryTxType
  notes: string | null
  reference_id: string | null
  created_at: string
  created_by: string | null
}

function emptyBalances(): StationeryBalances {
  return { stamps: 0 }
}

export async function ensureStationeryWallet(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('lawyer_stationery_wallets')
    .upsert({ lawyer_id: lawyerId }, { onConflict: 'lawyer_id', ignoreDuplicates: true })
  if (error && !/duplicate|unique/i.test(error.message)) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function fetchStationeryBalances(
  supabase: SupabaseClient,
  lawyerId: string,
): Promise<StationeryBalances> {
  const { data, error } = await supabase
    .from('lawyer_stationery_wallets')
    .select('stamps_balance')
    .eq('lawyer_id', lawyerId)
    .maybeSingle()

  if (error) {
    if (/lawyer_stationery_wallets|schema cache|does not exist|files_balance/i.test(error.message)) {
      return emptyBalances()
    }
    console.error('[fetchStationeryBalances]', error.message)
    return emptyBalances()
  }
  if (!data) return emptyBalances()
  return {
    stamps: Math.max(0, Number(data.stamps_balance ?? 0)),
  }
}

export async function fetchStationeryBalancesMap(
  supabase: SupabaseClient,
  lawyerIds: string[],
): Promise<Map<string, StationeryBalances>> {
  const map = new Map<string, StationeryBalances>()
  for (const id of lawyerIds) map.set(id, emptyBalances())
  if (!lawyerIds.length) return map

  const { data, error } = await supabase
    .from('lawyer_stationery_wallets')
    .select('lawyer_id, stamps_balance')
    .in('lawyer_id', lawyerIds)

  if (error) {
    console.error('[fetchStationeryBalancesMap]', error.message)
    return map
  }
  for (const row of data ?? []) {
    map.set(row.lawyer_id, {
      stamps: Math.max(0, Number(row.stamps_balance ?? 0)),
    })
  }
  return map
}

export async function fetchStationeryTransactions(
  supabase: SupabaseClient,
  lawyerId: string,
  limit = 50,
): Promise<StationeryTxRow[]> {
  const { data, error } = await supabase
    .from('lawyer_stationery_transactions')
    .select('id, lawyer_id, item, amount, type, notes, reference_id, created_at, created_by')
    .eq('lawyer_id', lawyerId)
    .eq('item', 'stamps')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[fetchStationeryTransactions]', error.message)
    return []
  }
  return (data ?? []) as StationeryTxRow[]
}

async function adjustStampsBalance(
  supabase: SupabaseClient,
  lawyerId: string,
  delta: number,
): Promise<{ ok: boolean; error?: string; balance?: number }> {
  await ensureStationeryWallet(supabase, lawyerId)
  const current = await fetchStationeryBalances(supabase, lawyerId)
  const next = current.stamps + delta
  if (next < 0) {
    return {
      ok: false,
      error: `رصيد الطوابع غير كافٍ (المتوفر: ${current.stamps})`,
    }
  }

  const { error } = await supabase
    .from('lawyer_stationery_wallets')
    .update({ stamps_balance: next, updated_at: new Date().toISOString() } as any)
    .eq('lawyer_id', lawyerId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, balance: next }
}

export async function depositStationery(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    amount: number
    notes?: string | null
    createdBy: string
    referenceId?: string | null
    /** للتوافق — يُتجاهل إن وُجد، الطوابع فقط */
    item?: StationeryItem
  },
): Promise<{ ok: boolean; error?: string }> {
  const amount = Math.floor(Number(params.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'الكمية يجب أن تكون أكبر من صفر' }
  }

  const adj = await adjustStampsBalance(supabase, params.lawyerId, amount)
  if (!adj.ok) return adj

  const { error } = await supabase.from('lawyer_stationery_transactions').insert({
    lawyer_id: params.lawyerId,
    item: 'stamps',
    amount,
    type: 'deposit',
    notes: params.notes?.trim() || `إيداع ${STATIONERY_ITEM_LABELS.stamps}`,
    reference_id: params.referenceId ?? null,
    created_by: params.createdBy,
  })

  if (error) {
    await adjustStampsBalance(supabase, params.lawyerId, -amount)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function withdrawStationery(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    amount: number
    notes?: string | null
    createdBy: string
    referenceId?: string | null
    item?: StationeryItem
  },
): Promise<{ ok: boolean; error?: string }> {
  const amount = Math.floor(Number(params.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'الكمية يجب أن تكون أكبر من صفر' }
  }

  const adj = await adjustStampsBalance(supabase, params.lawyerId, -amount)
  if (!adj.ok) return adj

  const { error } = await supabase.from('lawyer_stationery_transactions').insert({
    lawyer_id: params.lawyerId,
    item: 'stamps',
    amount: -amount,
    type: 'withdrawal',
    notes: params.notes?.trim() || `سحب ${STATIONERY_ITEM_LABELS.stamps}`,
    reference_id: params.referenceId ?? null,
    created_by: params.createdBy,
  })

  if (error) {
    await adjustStampsBalance(supabase, params.lawyerId, amount)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * خصم تلقائي عند الاعتماد النهائي لإقامة دعوى — طابع واحد.
 * idempotent عبر reference_id = taskId.
 */
export async function deductStationeryOnLawsuitApproval(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    taskId: string
    reviewedBy: string
  },
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const { data: existing } = await supabase
    .from('lawyer_stationery_transactions')
    .select('id')
    .eq('reference_id', params.taskId)
    .eq('type', 'lawsuit_deduction')
    .eq('item', 'stamps')
    .limit(1)

  if (existing?.length) {
    return { ok: true, skipped: true }
  }

  const balances = await fetchStationeryBalances(supabase, params.lawyerId)
  const needStamps = LAWSUIT_STATIONERY_DEDUCT.stamps

  if (balances.stamps < needStamps) {
    return {
      ok: false,
      error: `رصيد الطوابع غير كافٍ لاعتماد إقامة الدعوى (المتوفر: ${balances.stamps}، المطلوب: ${needStamps})`,
    }
  }

  const stampsAdj = await adjustStampsBalance(supabase, params.lawyerId, -needStamps)
  if (!stampsAdj.ok) return stampsAdj

  const { error } = await supabase.from('lawyer_stationery_transactions').insert({
    lawyer_id: params.lawyerId,
    item: 'stamps',
    amount: -needStamps,
    type: 'lawsuit_deduction',
    notes: 'خصم تلقائي — اعتماد إنجاز إقامة دعوى (طابع)',
    reference_id: params.taskId,
    created_by: params.reviewedBy,
  })

  if (error) {
    await adjustStampsBalance(supabase, params.lawyerId, needStamps)
    return { ok: false, error: error.message }
  }

  return { ok: true }
}

/** إلغاء خصم إقامة دعوى عند فشل الاعتماد النهائي بعد الخصم */
export async function reverseStationeryLawsuitDeduction(
  supabase: SupabaseClient,
  taskId: string,
  _reversedBy: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: rows } = await supabase
    .from('lawyer_stationery_transactions')
    .select('id, lawyer_id, item, amount')
    .eq('reference_id', taskId)
    .eq('type', 'lawsuit_deduction')

  if (!rows?.length) return { ok: true }

  const lawyerId = rows[0].lawyer_id as string
  for (const row of rows) {
    // نتجاهل أي حركات فايلات قديمة إن وُجدت — لا عمود لها بعد الترحيل
    if (row.item !== 'stamps') continue
    const deducted = Math.abs(Number(row.amount ?? 0))
    if (deducted <= 0) continue
    const adj = await adjustStampsBalance(supabase, lawyerId, deducted)
    if (!adj.ok) return adj
  }

  const { error } = await supabase
    .from('lawyer_stationery_transactions')
    .delete()
    .eq('reference_id', taskId)
    .eq('type', 'lawsuit_deduction')

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export function stationeryTxLabel(row: Pick<StationeryTxRow, 'type' | 'item' | 'amount'>): string {
  const item = STATIONERY_ITEM_LABELS[row.item as StationeryItem] ?? 'الطوابع'
  if (row.type === 'deposit') return `إيداع ${item}`
  if (row.type === 'withdrawal') return `سحب ${item}`
  if (row.type === 'lawsuit_deduction') return `خصم إقامة دعوى — ${item}`
  return item
}
