import type { SupabaseClient } from '@supabase/supabase-js'

export type StationeryItem = 'files' | 'stamps'
export type StationeryTxType = 'deposit' | 'withdrawal' | 'lawsuit_deduction'

export const STATIONERY_ITEM_LABELS: Record<StationeryItem, string> = {
  files: 'الفايلات',
  stamps: 'الطوابع',
}

export const STATIONERY_WALLET_LABEL = 'محفظة القرطاسية'

/** خصم تلقائي عند الاعتماد النهائي لإقامة دعوى */
export const LAWSUIT_STATIONERY_DEDUCT = {
  files: 1,
  stamps: 1,
} as const

export interface StationeryBalances {
  files: number
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
  return { files: 0, stamps: 0 }
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
    .select('files_balance, stamps_balance')
    .eq('lawyer_id', lawyerId)
    .maybeSingle()

  if (error) {
    if (/lawyer_stationery_wallets|schema cache|does not exist/i.test(error.message)) {
      return emptyBalances()
    }
    console.error('[fetchStationeryBalances]', error.message)
    return emptyBalances()
  }
  if (!data) return emptyBalances()
  return {
    files: Math.max(0, Number(data.files_balance ?? 0)),
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
    .select('lawyer_id, files_balance, stamps_balance')
    .in('lawyer_id', lawyerIds)

  if (error) {
    console.error('[fetchStationeryBalancesMap]', error.message)
    return map
  }
  for (const row of data ?? []) {
    map.set(row.lawyer_id, {
      files: Math.max(0, Number(row.files_balance ?? 0)),
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
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[fetchStationeryTransactions]', error.message)
    return []
  }
  return (data ?? []) as StationeryTxRow[]
}

async function adjustBalance(
  supabase: SupabaseClient,
  lawyerId: string,
  item: StationeryItem,
  delta: number,
): Promise<{ ok: boolean; error?: string; balance?: number }> {
  await ensureStationeryWallet(supabase, lawyerId)
  const current = await fetchStationeryBalances(supabase, lawyerId)
  const key = item === 'files' ? 'files' : 'stamps'
  const next = current[key] + delta
  if (next < 0) {
    return {
      ok: false,
      error: item === 'files'
        ? `رصيد الفايلات غير كافٍ (المتوفر: ${current.files})`
        : `رصيد الطوابع غير كافٍ (المتوفر: ${current.stamps})`,
    }
  }

  const col = item === 'files' ? 'files_balance' : 'stamps_balance'
  const { error } = await supabase
    .from('lawyer_stationery_wallets')
    .update({ [col]: next, updated_at: new Date().toISOString() } as any)
    .eq('lawyer_id', lawyerId)

  if (error) return { ok: false, error: error.message }
  return { ok: true, balance: next }
}

export async function depositStationery(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    item: StationeryItem
    amount: number
    notes?: string | null
    createdBy: string
    referenceId?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const amount = Math.floor(Number(params.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'الكمية يجب أن تكون أكبر من صفر' }
  }

  const adj = await adjustBalance(supabase, params.lawyerId, params.item, amount)
  if (!adj.ok) return adj

  const { error } = await supabase.from('lawyer_stationery_transactions').insert({
    lawyer_id: params.lawyerId,
    item: params.item,
    amount,
    type: 'deposit',
    notes: params.notes?.trim() || `إيداع ${STATIONERY_ITEM_LABELS[params.item]}`,
    reference_id: params.referenceId ?? null,
    created_by: params.createdBy,
  })

  if (error) {
    await adjustBalance(supabase, params.lawyerId, params.item, -amount)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function withdrawStationery(
  supabase: SupabaseClient,
  params: {
    lawyerId: string
    item: StationeryItem
    amount: number
    notes?: string | null
    createdBy: string
    referenceId?: string | null
  },
): Promise<{ ok: boolean; error?: string }> {
  const amount = Math.floor(Number(params.amount))
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'الكمية يجب أن تكون أكبر من صفر' }
  }

  const adj = await adjustBalance(supabase, params.lawyerId, params.item, -amount)
  if (!adj.ok) return adj

  const { error } = await supabase.from('lawyer_stationery_transactions').insert({
    lawyer_id: params.lawyerId,
    item: params.item,
    amount: -amount,
    type: 'withdrawal',
    notes: params.notes?.trim() || `سحب ${STATIONERY_ITEM_LABELS[params.item]}`,
    reference_id: params.referenceId ?? null,
    created_by: params.createdBy,
  })

  if (error) {
    await adjustBalance(supabase, params.lawyerId, params.item, amount)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * خصم تلقائي عند الاعتماد النهائي لإقامة دعوى — فايل واحد + طابع واحد.
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
    .limit(1)

  if (existing?.length) {
    return { ok: true, skipped: true }
  }

  const balances = await fetchStationeryBalances(supabase, params.lawyerId)
  const needFiles = LAWSUIT_STATIONERY_DEDUCT.files
  const needStamps = LAWSUIT_STATIONERY_DEDUCT.stamps

  if (balances.files < needFiles) {
    return {
      ok: false,
      error: `رصيد الفايلات غير كافٍ لاعتماد إقامة الدعوى (المتوفر: ${balances.files}، المطلوب: ${needFiles})`,
    }
  }
  if (balances.stamps < needStamps) {
    return {
      ok: false,
      error: `رصيد الطوابع غير كافٍ لاعتماد إقامة الدعوى (المتوفر: ${balances.stamps}، المطلوب: ${needStamps})`,
    }
  }

  const filesAdj = await adjustBalance(supabase, params.lawyerId, 'files', -needFiles)
  if (!filesAdj.ok) return filesAdj

  const stampsAdj = await adjustBalance(supabase, params.lawyerId, 'stamps', -needStamps)
  if (!stampsAdj.ok) {
    await adjustBalance(supabase, params.lawyerId, 'files', needFiles)
    return stampsAdj
  }

  const { error } = await supabase.from('lawyer_stationery_transactions').insert([
    {
      lawyer_id: params.lawyerId,
      item: 'files',
      amount: -needFiles,
      type: 'lawsuit_deduction',
      notes: 'خصم تلقائي — اعتماد إنجاز إقامة دعوى (فايل)',
      reference_id: params.taskId,
      created_by: params.reviewedBy,
    },
    {
      lawyer_id: params.lawyerId,
      item: 'stamps',
      amount: -needStamps,
      type: 'lawsuit_deduction',
      notes: 'خصم تلقائي — اعتماد إنجاز إقامة دعوى (طابع)',
      reference_id: params.taskId,
      created_by: params.reviewedBy,
    },
  ])

  if (error) {
    await adjustBalance(supabase, params.lawyerId, 'files', needFiles)
    await adjustBalance(supabase, params.lawyerId, 'stamps', needStamps)
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
    const item = row.item as StationeryItem
    const deducted = Math.abs(Number(row.amount ?? 0))
    if (deducted <= 0) continue
    const adj = await adjustBalance(supabase, lawyerId, item, deducted)
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
  const item = STATIONERY_ITEM_LABELS[row.item] ?? row.item
  if (row.type === 'deposit') return `إيداع ${item}`
  if (row.type === 'withdrawal') return `سحب ${item}`
  if (row.type === 'lawsuit_deduction') return `خصم إقامة دعوى — ${item}`
  return item
}
