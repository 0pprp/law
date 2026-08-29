import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACHIEVEMENT_STATUSES,
  achievementDate,
  achievementFee,
  achievementLabel,
  type AchievementTask,
} from '@/lib/achievement-report'
import {
  fetchLawyerBalancesMap,
  fetchLawyerSavingsBalancesMap,
  type LawyerWalletRow,
} from '@/lib/lawyer-wallet'
import {
  fetchStationeryBalancesMap,
  fetchStationeryTransactions,
  type StationeryBalances,
  type StationeryTxRow,
  STATIONERY_ITEM_LABELS,
} from '@/lib/lawyer-stationery-wallet'

export type LawyerProfileBrief = {
  id: string
  full_name: string
  phone: string | null
  governorate: string | null
  branch_id: string | null
  lawyer_type: string | null
  case_type: string | null
  is_active: boolean | null
}

export type LawyerCompletedTaskRow = AchievementTask & {
  debtors?: { full_name?: string | null; receipt_number?: string | null; governorate?: string | null } | null
}

export type LawyerExpenseRow = {
  id: string
  amount: number | null
  expense_type: string | null
  description: string | null
  expense_date: string | null
  status: string | null
  created_at: string
  debtor_id: string | null
  created_by: string | null
  debtors?: { full_name?: string | null } | null
  tasks?: { task_type?: string | null; task_definitions?: { label?: string | null } | null } | null
}

export type LawyerStatsSummary = {
  lawyer: LawyerProfileBrief
  completedCount: number
  feesEarnedInPeriod: number
  feesBalance: number
  savingsBalance: number
  expensesTotalInPeriod: number
  expensesCountInPeriod: number
  stationery: StationeryBalances
  lastCompletedAt: string | null
}

function inDateRange(ymd: string, dateFrom?: string, dateTo?: string): boolean {
  if (dateFrom && ymd < dateFrom) return false
  if (dateTo && ymd > dateTo) return false
  return true
}

function ymdOf(iso: string | null | undefined): string {
  if (!iso) return ''
  return iso.split('T')[0]
}

export async function fetchBranchLawyerProfiles(
  supabase: SupabaseClient,
  branchId: string | null,
): Promise<LawyerProfileBrief[]> {
  let q = supabase
    .from('profiles')
    .select('id, full_name, phone, governorate, branch_id, lawyer_type, case_type, is_active')
    .eq('role', 'lawyer')
    .order('full_name')

  if (branchId) q = q.eq('branch_id', branchId)

  const { data, error } = await q
  if (error) {
    console.error('[fetchBranchLawyerProfiles]', error.message)
    return []
  }
  return (data ?? []) as LawyerProfileBrief[]
}

export async function fetchLawyerCompletedTasks(
  supabase: SupabaseClient,
  opts: {
    lawyerIds: string[]
    branchId: string | null
    dateFrom?: string
    dateTo?: string
  },
): Promise<LawyerCompletedTaskRow[]> {
  const { lawyerIds, branchId, dateFrom, dateTo } = opts
  if (!lawyerIds.length) return []

  let q = supabase
    .from('tasks')
    .select(
      'id, task_type, task_status, assigned_to, debtor_id, completed_at, created_at, task_definition_id, reward_amount, branch_id, ' +
        'task_definitions(label), debtors!tasks_debtor_id_fkey(full_name, receipt_number, governorate, case_type)',
    )
    .in('task_status', [...ACHIEVEMENT_STATUSES])
    .in('assigned_to', lawyerIds)
    .order('completed_at', { ascending: false })
    .limit(3000)

  if (branchId) q = q.eq('branch_id', branchId)

  const { data, error } = await q
  if (error) {
    console.error('[fetchLawyerCompletedTasks]', error.message)
    return []
  }

  const rows = (data ?? []).map(r => {
    const row = r as unknown as LawyerCompletedTaskRow & { debtors?: { case_type?: string | null } | null }
    return {
      ...row,
      case_type: row.debtors?.case_type ?? row.case_type ?? null,
    }
  })

  return rows.filter(t => inDateRange(achievementDate(t), dateFrom, dateTo))
}

export async function fetchLawyerExpensesForStats(
  supabase: SupabaseClient,
  opts: {
    lawyerIds: string[]
    branchId: string | null
    dateFrom?: string
    dateTo?: string
  },
): Promise<LawyerExpenseRow[]> {
  const { lawyerIds, branchId, dateFrom, dateTo } = opts
  if (!lawyerIds.length) return []

  let q = supabase
    .from('expenses')
    .select(
      'id, amount, expense_type, description, expense_date, status, created_at, debtor_id, created_by, ' +
        'debtors(full_name), tasks(task_type, task_definitions(label))',
    )
    .in('created_by', lawyerIds)
    .order('expense_date', { ascending: false })
    .limit(3000)

  if (branchId) q = q.eq('branch_id', branchId)
  if (dateFrom) q = q.gte('expense_date', dateFrom)
  if (dateTo) q = q.lte('expense_date', dateTo)

  const { data, error } = await q
  if (error) {
    console.error('[fetchLawyerExpensesForStats]', error.message)
    return []
  }
  return (data ?? []) as unknown as LawyerExpenseRow[]
}

export async function fetchLawyerFeeTxsForStats(
  supabase: SupabaseClient,
  lawyerId: string,
  opts?: { dateFrom?: string; dateTo?: string; limit?: number },
): Promise<LawyerWalletRow[]> {
  let q = supabase
    .from('lawyer_wallet_transactions')
    .select('id, lawyer_id, amount, type, wallet, notes, reference_id, created_at, created_by')
    .eq('lawyer_id', lawyerId)
    .or('wallet.eq.fees,wallet.is.null')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 500)

  if (opts?.dateFrom) q = q.gte('created_at', `${opts.dateFrom}T00:00:00`)
  if (opts?.dateTo) q = q.lte('created_at', `${opts.dateTo}T23:59:59.999`)

  const { data, error } = await q
  if (error) {
    // legacy without wallet column
    const legacy = await supabase
      .from('lawyer_wallet_transactions')
      .select('id, lawyer_id, amount, type, notes, reference_id, created_at, created_by')
      .eq('lawyer_id', lawyerId)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 500)
    if (legacy.error) {
      console.error('[fetchLawyerFeeTxsForStats]', error.message)
      return []
    }
    return ((legacy.data ?? []) as unknown as LawyerWalletRow[]).filter(tx => {
      const d = ymdOf(tx.created_at)
      return inDateRange(d, opts?.dateFrom, opts?.dateTo)
    })
  }
  return (data ?? []) as unknown as LawyerWalletRow[]
}

export async function fetchLawyerSavingsTxsForStats(
  supabase: SupabaseClient,
  lawyerId: string,
  opts?: { dateFrom?: string; dateTo?: string; limit?: number },
): Promise<LawyerWalletRow[]> {
  let q = supabase
    .from('lawyer_wallet_transactions')
    .select('id, lawyer_id, amount, type, wallet, notes, reference_id, created_at, created_by')
    .eq('lawyer_id', lawyerId)
    .eq('wallet', 'savings')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 500)

  if (opts?.dateFrom) q = q.gte('created_at', `${opts.dateFrom}T00:00:00`)
  if (opts?.dateTo) q = q.lte('created_at', `${opts.dateTo}T23:59:59.999`)

  const { data, error } = await q
  if (error) {
    console.error('[fetchLawyerSavingsTxsForStats]', error.message)
    return []
  }
  return (data ?? []) as unknown as LawyerWalletRow[]
}

export async function buildLawyerStatsSummaries(
  supabase: SupabaseClient,
  opts: {
    branchId: string | null
    dateFrom?: string
    dateTo?: string
    viewerRole?: string | null
  },
): Promise<{
  lawyers: LawyerProfileBrief[]
  summaries: LawyerStatsSummary[]
  completedByLawyer: Map<string, LawyerCompletedTaskRow[]>
  expensesByLawyer: Map<string, LawyerExpenseRow[]>
}> {
  const lawyers = await fetchBranchLawyerProfiles(supabase, opts.branchId)
  const ids = lawyers.map(l => l.id)
  if (!ids.length) {
    return {
      lawyers: [],
      summaries: [],
      completedByLawyer: new Map(),
      expensesByLawyer: new Map(),
    }
  }

  const [completed, expenses, feeBalances, savingsBalances, stationeryMap] = await Promise.all([
    fetchLawyerCompletedTasks(supabase, {
      lawyerIds: ids,
      branchId: opts.branchId,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
    }),
    fetchLawyerExpensesForStats(supabase, {
      lawyerIds: ids,
      branchId: opts.branchId,
      dateFrom: opts.dateFrom,
      dateTo: opts.dateTo,
    }),
    fetchLawyerBalancesMap(supabase, ids, { viewerRole: opts.viewerRole }),
    fetchLawyerSavingsBalancesMap(supabase, ids),
    fetchStationeryBalancesMap(supabase, ids),
  ])

  const completedByLawyer = new Map<string, LawyerCompletedTaskRow[]>()
  for (const t of completed) {
    if (!t.assigned_to) continue
    if (!completedByLawyer.has(t.assigned_to)) completedByLawyer.set(t.assigned_to, [])
    completedByLawyer.get(t.assigned_to)!.push(t)
  }

  const expensesByLawyer = new Map<string, LawyerExpenseRow[]>()
  for (const e of expenses) {
    const lid = e.created_by
    if (!lid) continue
    if (!expensesByLawyer.has(lid)) expensesByLawyer.set(lid, [])
    expensesByLawyer.get(lid)!.push(e)
  }

  const summaries: LawyerStatsSummary[] = lawyers.map(lawyer => {
    const tasks = completedByLawyer.get(lawyer.id) ?? []
    const exps = expensesByLawyer.get(lawyer.id) ?? []
    const feesEarned = tasks.reduce((s, t) => s + achievementFee(t, opts.viewerRole), 0)
    const expensesTotal = exps
      .filter(e => {
        const st = (e.status ?? 'approved').toLowerCase()
        return st === 'approved' || st === 'pending' || st === 'pending_review' || st === 'pending_approval'
      })
      .reduce((s, e) => s + Number(e.amount ?? 0), 0)
    const last = tasks[0] ? achievementDate(tasks[0]) : null

    return {
      lawyer,
      completedCount: tasks.length,
      feesEarnedInPeriod: feesEarned,
      feesBalance: feeBalances.get(lawyer.id) ?? 0,
      savingsBalance: savingsBalances.get(lawyer.id) ?? 0,
      expensesTotalInPeriod: expensesTotal,
      expensesCountInPeriod: exps.length,
      stationery: stationeryMap.get(lawyer.id) ?? { stamps: 0 },
      lastCompletedAt: last,
    }
  }).sort((a, b) => b.completedCount - a.completedCount || a.lawyer.full_name.localeCompare(b.lawyer.full_name, 'ar'))

  return { lawyers, summaries, completedByLawyer, expensesByLawyer }
}

export async function fetchLawyerDetailLogs(
  supabase: SupabaseClient,
  lawyerId: string,
  opts?: { dateFrom?: string; dateTo?: string; limit?: number },
): Promise<{
  feeTxs: LawyerWalletRow[]
  savingsTxs: LawyerWalletRow[]
  stationeryTxs: StationeryTxRow[]
}> {
  const limit = opts?.limit ?? 5000
  const [feeTxs, savingsTxs, stationeryTxs] = await Promise.all([
    fetchLawyerFeeTxsForStats(supabase, lawyerId, { ...opts, limit }),
    fetchLawyerSavingsTxsForStats(supabase, lawyerId, { ...opts, limit }),
    fetchStationeryTransactions(supabase, lawyerId, limit).then(rows =>
      rows.filter(r => inDateRange(ymdOf(r.created_at), opts?.dateFrom, opts?.dateTo)),
    ),
  ])
  return { feeTxs, savingsTxs, stationeryTxs }
}

export { achievementLabel, achievementFee, achievementDate, STATIONERY_ITEM_LABELS }
