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
  caseType?: 'civil' | 'criminal' | ''
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
  branchId: string | null,
  filters: ReportFilters,
): Promise<string[] | null> {
  let ids: string[] | null = null

  if (filters.debtorId) {
    if (filters.branchListId && branchId) {
      const listIds = await resolveDebtorIdsByBranchList(supabase, branchId, filters.branchListId)
      if (!listIds.includes(filters.debtorId)) return []
    }
    ids = [filters.debtorId]
  } else if (filters.branchListId && branchId) {
    ids = await resolveDebtorIdsByBranchList(supabase, branchId, filters.branchListId)
  }

  if (!filters.caseType) return ids

  let q = supabase.from('debtors').select('id').eq('case_type', filters.caseType)
  if (branchId) q = q.eq('branch_id', branchId)
  if (ids) {
    if (!ids.length) return []
    q = q.in('id', ids)
  }
  const { data } = await q
  return (data ?? []).map(d => d.id)
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
  branchId: string | null,
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
      .order(dateCol, { ascending: true })
      .range(offset, offset + CHUNK - 1)

    if (branchId) q = q.eq('branch_id', branchId)

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
  branchId: string | null,
  scopedDebtorIds: string[] | null,
): Promise<number> {
  if (scopedDebtorIds && scopedDebtorIds.length === 0) return 0

  let total = 0
  let offset = 0

  while (true) {
    let q = supabase
      .from('debtors')
      .select('required_amount')
      .order('id')
      .range(offset, offset + CHUNK - 1)

    if (branchId) q = q.eq('branch_id', branchId)

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
  branchId: string | null,
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
      .in('task_status', [...ACHIEVEMENT_STATUSES])
      .order('completed_at', { ascending: true, nullsFirst: false })
      .range(offset, offset + CHUNK - 1)

    if (branchId) q = q.eq('branch_id', branchId)

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
  branchId: string | null,
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
      .in('task_status', OPEN_STATUSES)
      .order('created_at', { ascending: true })
      .range(offset, offset + CHUNK - 1)

    if (branchId) q = q.eq('branch_id', branchId)

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

/** Active-case stage counts via chunked scan — no full debtor list in memory. branchId=null → كل الفروع. */
async function fetchStageCounts(
  supabase: SupabaseClient,
  branchId: string | null,
  taskDefs: { id: string; label: string; sort_order: number }[],
  caseType?: 'civil' | 'criminal' | '' | null,
): Promise<{ stageCounts: ReportSnapshot['stageCounts']; totalActive: number }> {
  const stageMap = new Map<string, { id: string; label: string; active: number; stalled: number }>()
  for (const def of taskDefs) {
    stageMap.set(def.id, { id: def.id, label: def.label, active: 0, stalled: 0 })
  }

  let totalActive = 0
  let offset = 0

  while (true) {
    let debtorsQ = supabase
      .from('debtors')
      .select('current_task_id')
      .or('case_status.is.null,case_status.neq.closed')
      .not('current_task_id', 'is', null)
      .order('id')
      .range(offset, offset + CHUNK - 1)
    if (branchId) debtorsQ = debtorsQ.eq('branch_id', branchId)
    if (caseType) debtorsQ = debtorsQ.eq('case_type', caseType)

    const { data: debtors, error } = await debtorsQ

    if (error) {
      console.error('[fetchStageCounts:debtors]', error.message ?? error)
      break
    }
    if (!debtors?.length) break

    const taskIds = debtors.map(d => d.current_task_id).filter(Boolean) as string[]
    if (taskIds.length) {
      let tasksQ = supabase
        .from('tasks')
        .select('id, task_definition_id, task_status')
        .in('id', taskIds)
      if (branchId) tasksQ = tasksQ.eq('branch_id', branchId)

      const { data: tasks } = await tasksQ

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

  let stageCounts = Array.from(stageMap.values())

  // عند كل الفروع: دمج المراحل بنفس الاسم حتى لا تتكرر الصفوف
  if (!branchId) {
    const byLabel = new Map<string, { id: string; label: string; active: number; stalled: number; sort: number }>()
    const sortById = new Map(taskDefs.map(d => [d.id, d.sort_order ?? 999]))
    for (const s of stageCounts) {
      const key = s.label.trim().toLowerCase() || s.id
      const prev = byLabel.get(key)
      if (!prev) {
        byLabel.set(key, { ...s, sort: sortById.get(s.id) ?? 999 })
      } else {
        prev.active += s.active
        prev.stalled += s.stalled
        const sort = sortById.get(s.id) ?? 999
        if (sort < prev.sort) prev.sort = sort
      }
    }
    stageCounts = Array.from(byLabel.values())
      .sort((a, b) => a.sort - b.sort)
      .map(({ id, label, active, stalled }) => ({ id, label, active, stalled }))
  }

  return { stageCounts, totalActive }
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
    const label = t.task_definitions?.label ?? t.task_type ?? '—'
    const key = label.trim().toLowerCase() || (t.task_definition_id ?? t.id)
    const cur = map.get(key) ?? { label, count: 0 }
    cur.count++
    map.set(key, cur)
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 8)
}

/** Load report data on demand. branchId=null → كل الفروع (محاسب عام). */
export async function fetchReportSnapshot(
  supabase: SupabaseClient,
  branchId: string | null,
  filters: ReportFilters,
): Promise<ReportSnapshot | null> {
  const scopedDebtorIds = await resolveScopedDebtorIds(supabase, branchId, filters)

  let closedQ = supabase
    .from('debtors')
    .select('id', { count: 'exact', head: true })
    .eq('case_status', 'closed')
  if (branchId) closedQ = closedQ.eq('branch_id', branchId)
  closedQ = applyDebtorScope(closedQ, 'id', scopedDebtorIds)

  const branchLawyersPromise = branchId
    ? supabase
        .from('profiles')
        .select('id, full_name, governorate, lawyer_type')
        .eq('branch_id', branchId)
        .eq('role', 'lawyer')
        .eq('is_active', true)
        .order('full_name')
    : supabase
        .from('profiles')
        .select('id, full_name, governorate, lawyer_type')
        .eq('role', 'lawyer')
        .eq('is_active', true)
        .order('full_name')

  const [branchLawyersRes, generalLawyersRes, taskDefsRes, closedRes] = await Promise.all([
    branchLawyersPromise,
    branchId
      ? supabase
          .from('profiles')
          .select('id, full_name, governorate, lawyer_type')
          .eq('role', 'lawyer')
          .eq('lawyer_type', 'general')
          .eq('is_active', true)
          .order('full_name')
      : Promise.resolve({ data: [] as { id: string; full_name: string; governorate: string | null; lawyer_type: string | null }[] }),
    branchId
      ? (() => {
          let q = supabase
            .from('task_definitions')
            .select('id, label, sort_order')
            .eq('branch_id', branchId)
            .eq('is_active', true)
            .order('sort_order')
          if (filters.caseType) q = q.eq('case_type', filters.caseType)
          return q
        })()
      : (() => {
          let q = supabase
            .from('task_definitions')
            .select('id, label, sort_order')
            .eq('is_active', true)
            .order('sort_order')
            .limit(200)
          if (filters.caseType) q = q.eq('case_type', filters.caseType)
          return q
        })(),
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
    fetchStageCounts(supabase, branchId, taskDefs, filters.caseType || null),
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
