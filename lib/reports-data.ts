import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ACHIEVEMENT_STATUSES,
  type AchievementTask,
  filterAchievements,
  buildAchievementByType,
  buildAchievementByLawyer,
} from '@/lib/achievement-report'
import { STALLED_STATUSES } from '@/lib/stage-config'
import { resolveDebtorIdsByBranchList } from '@/lib/branch-lists'

export interface ReportFilters {
  dateFrom?: string
  dateTo?: string
  debtorId?: string
  lawyerId?: string
  branchListId?: string
}

const CHUNK = 500
const OPEN_STATUSES = ['new', 'in_progress', 'postponed', 'needs_info']

export interface ReportSnapshot {
  lawyers: { id: string; full_name: string; governorate?: string | null }[]
  taskDefs: { id: string; label: string; sort_order: number }[]
  closedCount: number
  totalRequired: number
  totalPayments: number
  totalExpenses: number
  achievements: AchievementTask[]
  openTaskCount: number
  stageCounts: { id: string; label: string; active: number; stalled: number }[]
  totalActive: number
  avgTransitionDays: number | null
  topTasks: { label: string; count: number }[]
}

async function resolveScopedDebtorIds(
  supabase: SupabaseClient,
  branchId: string,
  filters: ReportFilters,
): Promise<string[] | null> {
  if (filters.debtorId) {
    if (filters.branchListId) {
      const listIds = await resolveDebtorIdsByBranchList(supabase, branchId, filters.branchListId)
      if (!listIds.includes(filters.debtorId)) return []
    }
    return [filters.debtorId]
  }
  if (filters.branchListId) {
    return resolveDebtorIdsByBranchList(supabase, branchId, filters.branchListId)
  }
  return null
}

function applyDebtorScope<T extends { eq: (col: string, val: string) => T; in: (col: string, vals: string[]) => T }>(
  q: T,
  column: string,
  scopedDebtorIds: string[] | null,
): T {
  if (!scopedDebtorIds) return q
  if (scopedDebtorIds.length === 0) return q.eq(column, '__none__')
  if (scopedDebtorIds.length === 1) return q.eq(column, scopedDebtorIds[0])
  return q.in(column, scopedDebtorIds)
}

async function sumColumnChunked(
  supabase: SupabaseClient,
  table: 'debtor_payments' | 'expenses',
  branchId: string,
  amountCol: 'amount',
  dateCol: 'payment_date' | 'expense_date',
  filters: ReportFilters,
  scopedDebtorIds: string[] | null,
  extra?: { lawyerCol?: 'lawyer_id' },
): Promise<number> {
  if (scopedDebtorIds && scopedDebtorIds.length === 0) return 0

  let total = 0
  let offset = 0

  while (true) {
    let q = supabase
      .from(table)
      .select(amountCol)
      .eq('branch_id', branchId)
      .order(dateCol, { ascending: true })
      .range(offset, offset + CHUNK - 1)

    const { dateFrom, dateTo, lawyerId } = filters
    if (dateFrom) q = q.gte(dateCol, dateFrom)
    if (dateTo) q = q.lte(dateCol, dateTo)
    q = applyDebtorScope(q, 'debtor_id', scopedDebtorIds)
    if (lawyerId && extra?.lawyerCol) q = q.eq(extra.lawyerCol, lawyerId)

    const { data, error } = await q
    if (error) {
      console.error(`[sumColumnChunked:${table}]`, error.message ?? error)
      break
    }
    if (!data?.length) break

    for (const row of data) {
      total += Number((row as Record<string, unknown>)[amountCol] ?? 0)
    }
    if (data.length < CHUNK) break
    offset += CHUNK
  }

  return total
}

async function sumRequiredAmount(
  supabase: SupabaseClient,
  branchId: string,
  scopedDebtorIds: string[] | null,
): Promise<number> {
  if (scopedDebtorIds && scopedDebtorIds.length === 0) return 0

  let total = 0
  let offset = 0

  while (true) {
    let q = supabase
      .from('debtors')
      .select('required_amount')
      .eq('branch_id', branchId)
      .order('id')
      .range(offset, offset + CHUNK - 1)

    q = applyDebtorScope(q, 'id', scopedDebtorIds)

    const { data, error } = await q
    if (error) {
      console.error('[sumRequiredAmount]', error.message ?? error)
      break
    }
    if (!data?.length) break

    for (const row of data) {
      total += Number(row.required_amount ?? 0)
    }
    if (data.length < CHUNK) break
    offset += CHUNK
  }

  return total
}

async function fetchAchievementTasks(
  supabase: SupabaseClient,
  branchId: string,
  filters: ReportFilters,
  scopedDebtorIds: string[] | null,
): Promise<AchievementTask[]> {
  if (scopedDebtorIds && scopedDebtorIds.length === 0) return []

  const rows: AchievementTask[] = []
  let offset = 0

  while (true) {
    let q = supabase
      .from('tasks')
      .select(
        'id, task_type, task_status, assigned_to, debtor_id, completed_at, created_at, task_definition_id, reward_amount, task_definitions(label)',
      )
      .eq('branch_id', branchId)
      .in('task_status', [...ACHIEVEMENT_STATUSES])
      .order('completed_at', { ascending: true, nullsFirst: false })
      .range(offset, offset + CHUNK - 1)

    const { lawyerId, dateFrom, dateTo } = filters
    q = applyDebtorScope(q, 'debtor_id', scopedDebtorIds)
    if (lawyerId) q = q.eq('assigned_to', lawyerId)
    if (dateFrom) q = q.gte('completed_at', `${dateFrom}T00:00:00`)
    if (dateTo) q = q.lte('completed_at', `${dateTo}T23:59:59`)

    const { data, error } = await q
    if (error) {
      console.error('[fetchAchievementTasks]', error.message ?? error)
      break
    }
    if (!data?.length) break

    rows.push(...(data as unknown as AchievementTask[]))
    if (data.length < CHUNK) break
    offset += CHUNK
  }

  return filterAchievements(rows, filters)
}

async function countOpenTasks(
  supabase: SupabaseClient,
  branchId: string,
  filters: ReportFilters,
  scopedDebtorIds: string[] | null,
): Promise<number> {
  if (scopedDebtorIds && scopedDebtorIds.length === 0) return 0

  let total = 0
  let offset = 0

  while (true) {
    let q = supabase
      .from('tasks')
      .select('id, task_status')
      .eq('branch_id', branchId)
      .in('task_status', OPEN_STATUSES)
      .order('created_at', { ascending: true })
      .range(offset, offset + CHUNK - 1)

    q = applyDebtorScope(q, 'debtor_id', scopedDebtorIds)
    if (filters.lawyerId) q = q.eq('assigned_to', filters.lawyerId)

    const { data, error } = await q
    if (error) {
      console.error('[countOpenTasks]', error.message ?? error)
      break
    }
    if (!data?.length) break
    total += data.length
    if (data.length < CHUNK) break
    offset += CHUNK
  }

  return total
}

/** Active-case stage counts via chunked scan — no full debtor list in memory. */
async function fetchStageCounts(
  supabase: SupabaseClient,
  branchId: string,
  taskDefs: { id: string; label: string; sort_order: number }[],
): Promise<{ stageCounts: ReportSnapshot['stageCounts']; totalActive: number }> {
  const stageMap = new Map<string, { id: string; label: string; active: number; stalled: number }>()
  for (const def of taskDefs) {
    stageMap.set(def.id, { id: def.id, label: def.label, active: 0, stalled: 0 })
  }

  let totalActive = 0
  let offset = 0

  while (true) {
    const { data: debtors, error } = await supabase
      .from('debtors')
      .select('current_task_id')
      .eq('branch_id', branchId)
      .or('case_status.is.null,case_status.neq.closed')
      .not('current_task_id', 'is', null)
      .order('id')
      .range(offset, offset + CHUNK - 1)

    if (error) {
      console.error('[fetchStageCounts:debtors]', error.message ?? error)
      break
    }
    if (!debtors?.length) break

    const taskIds = debtors.map(d => d.current_task_id).filter(Boolean) as string[]
    if (taskIds.length) {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, task_definition_id, task_status')
        .eq('branch_id', branchId)
        .in('id', taskIds)

      for (const task of tasks ?? []) {
        if (!task.task_definition_id) continue
        const entry = stageMap.get(task.task_definition_id)
        if (!entry) continue
        entry.active++
        totalActive++
        if (STALLED_STATUSES.includes(task.task_status)) entry.stalled++
      }
    }

    if (debtors.length < CHUNK) break
    offset += CHUNK
  }

  return { stageCounts: Array.from(stageMap.values()), totalActive }
}

function computeAvgTransitionDays(achievements: AchievementTask[]): number | null {
  const byDebtor = new Map<string, AchievementTask[]>()
  for (const t of achievements) {
    if (!byDebtor.has(t.debtor_id)) byDebtor.set(t.debtor_id, [])
    byDebtor.get(t.debtor_id)!.push(t)
  }

  const gaps: number[] = []
  for (const list of byDebtor.values()) {
    list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    for (let i = 1; i < list.length; i++) {
      const prevCompleted = list[i - 1].completed_at
      if (!prevCompleted) continue
      const days =
        (new Date(list[i].created_at).getTime() - new Date(prevCompleted).getTime()) / 86400000
      if (days >= 0 && days < 365) gaps.push(days)
    }
  }

  return gaps.length > 0 ? Math.round(gaps.reduce((s, d) => s + d, 0) / gaps.length) : null
}

function buildTopTasks(achievements: AchievementTask[]): { label: string; count: number }[] {
  const map = new Map<string, { label: string; count: number }>()
  for (const t of achievements) {
    const defId = t.task_definition_id ?? t.task_type ?? t.id
    const label = t.task_definitions?.label ?? t.task_type ?? '—'
    const cur = map.get(defId) ?? { label, count: 0 }
    cur.count++
    map.set(defId, cur)
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 8)
}

/** Load report data on demand with branch-first filtered queries. */
export async function fetchReportSnapshot(
  supabase: SupabaseClient,
  branchId: string | null,
  filters: ReportFilters,
): Promise<ReportSnapshot | null> {
  if (!branchId) return null

  const scopedDebtorIds = await resolveScopedDebtorIds(supabase, branchId, filters)

  let closedQ = supabase
    .from('debtors')
    .select('id', { count: 'exact', head: true })
    .eq('branch_id', branchId)
    .eq('case_status', 'closed')
  closedQ = applyDebtorScope(closedQ, 'id', scopedDebtorIds)

  const [branchLawyersRes, generalLawyersRes, taskDefsRes, closedRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, governorate, lawyer_type')
      .eq('branch_id', branchId)
      .eq('role', 'lawyer')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('profiles')
      .select('id, full_name, governorate, lawyer_type')
      .eq('role', 'lawyer')
      .eq('lawyer_type', 'general')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('task_definitions')
      .select('id, label, sort_order')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('sort_order'),
    closedQ,
  ])

  const taskDefs = taskDefsRes.data ?? []
  const lawyerMap = new Map<string, { id: string; full_name: string; governorate: string | null }>()
  for (const l of [...(branchLawyersRes.data ?? []), ...(generalLawyersRes.data ?? [])]) {
    if (!lawyerMap.has(l.id)) {
      const suffix = l.lawyer_type === 'general' ? ' (محامي عام)' : ''
      lawyerMap.set(l.id, { id: l.id, full_name: `${l.full_name}${suffix}`, governorate: l.governorate })
    }
  }
  const lawyers = Array.from(lawyerMap.values()).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'))

  const [
    totalPayments,
    totalExpenses,
    totalRequired,
    achievements,
    openTaskCount,
    stageData,
  ] = await Promise.all([
    sumColumnChunked(supabase, 'debtor_payments', branchId, 'amount', 'payment_date', filters, scopedDebtorIds, {
      lawyerCol: 'lawyer_id',
    }),
    sumColumnChunked(supabase, 'expenses', branchId, 'amount', 'expense_date', filters, scopedDebtorIds),
    sumRequiredAmount(supabase, branchId, scopedDebtorIds),
    fetchAchievementTasks(supabase, branchId, filters, scopedDebtorIds),
    countOpenTasks(supabase, branchId, filters, scopedDebtorIds),
    fetchStageCounts(supabase, branchId, taskDefs),
  ])

  return {
    lawyers,
    taskDefs,
    closedCount: closedRes.count ?? 0,
    totalRequired,
    totalPayments,
    totalExpenses,
    achievements,
    openTaskCount,
    stageCounts: stageData.stageCounts,
    totalActive: stageData.totalActive,
    avgTransitionDays: computeAvgTransitionDays(achievements),
    topTasks: buildTopTasks(achievements),
  }
}

export { buildAchievementByType, buildAchievementByLawyer }
