import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * «الأسماء التي تحت إسناد مهمة» — مدينون بانتظار تعيين مهمة مطلوبة:
 * 1) current_task_id IS NULL
 * 2) أو مهمة حالية بلا تعريف وغير مكلّفة (تُعامل كمن يحتاج إسناد مهمة)
 */
export interface AwaitingAssignmentDebtor {
  id: string
  full_name: string
  branch_id: string | null
  branch_name: string | null
  branch_list_id: string | null
  branch_list_name: string | null
  created_at: string
  assignment_note: string | null
  case_type: 'civil' | 'criminal'
  /** true إذا كان لديه مهمة حالية بلا تعريف — يحتاج استبدال/تعيين نوع */
  needs_task_definition?: boolean
}

export interface FetchAwaitingAssignmentOptions {
  search?: string
  offset?: number
  limit?: number
  branchListId?: string | null
  /** عزل القسم — يُمرَّر من filterBySection(resolveCaseScope(...)) */
  caseType?: 'civil' | 'criminal' | null
}

export interface FetchAwaitingAssignmentResult {
  rows: AwaitingAssignmentDebtor[]
  total: number
  /** عمود assignment_note غير مطبق بعد في قاعدة البيانات */
  noteColumnMissing: boolean
  error: string | null
}

/** أعمدة المدين + اسم القائمة عبر علاقة PostgREST (بدون N+1) */
const BASE_COLS =
  'id, full_name, branch_id, branch_list_id, created_at, case_type, branch_list:branch_lists(name)'

/** حالات نهائية لا تُحسب ضمن صفوف «تحت إسناد» للمهام اليتيمة */
const TERMINAL_TASK_STATUSES = new Set([
  'approved',
  'completed',
  'closed',
  'cancelled',
  'rejected_final',
])

function isMissingNoteColumnError(message: string | undefined | null): boolean {
  return !!message && message.includes('assignment_note')
}

type BranchListEmbed = { name?: string | null } | { name?: string | null }[] | null | undefined

/** يستخرج اسم القائمة من embed PostgREST بأمان (كائن أو مصفوفة أو null) */
export function resolveBranchListName(embed: BranchListEmbed): string | null {
  if (!embed) return null
  const row = Array.isArray(embed) ? embed[0] : embed
  const name = row?.name?.trim()
  return name || null
}

type RawDebtor = {
  id: string
  full_name: string | null
  branch_id: string | null
  branch_list_id?: string | null
  branch_list?: BranchListEmbed
  created_at: string
  case_type?: string | null
  assignment_note?: string | null
  needs_task_definition?: boolean
}

function mapRows(
  raw: RawDebtor[],
  branchNames: Map<string, string>,
): AwaitingAssignmentDebtor[] {
  return raw.map(r => ({
    id: r.id,
    full_name: r.full_name ?? '—',
    branch_id: r.branch_id,
    branch_name: r.branch_id ? branchNames.get(r.branch_id) ?? null : null,
    branch_list_id: r.branch_list_id ?? null,
    branch_list_name: resolveBranchListName(r.branch_list),
    created_at: r.created_at,
    assignment_note: r.assignment_note ?? null,
    case_type: r.case_type === 'criminal' ? 'criminal' : 'civil',
    needs_task_definition: Boolean(r.needs_task_definition),
  }))
}

async function loadBranchNames(
  supabase: SupabaseClient,
  raw: RawDebtor[],
): Promise<Map<string, string>> {
  const branchIds = [...new Set(raw.map(r => r.branch_id).filter(Boolean))] as string[]
  const branchNames = new Map<string, string>()
  if (branchIds.length) {
    const { data: branches } = await supabase.from('branches').select('id, name').in('id', branchIds)
    for (const b of branches ?? []) branchNames.set(b.id, b.name)
  }
  return branchNames
}

/**
 * مدينون بمهمة حالية بلا تعريف وغير مكلّفة — يُعاملون كحاجة لإسناد مهمة.
 */
async function fetchUntypedUnassignedDebtors(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchAwaitingAssignmentOptions,
): Promise<{ rows: RawDebtor[]; error: string | null; noteColumnMissing: boolean }> {
  const search = (options?.search ?? '').trim().replace(/[%_,]/g, '')
  const branchListId = options?.branchListId?.trim() || null
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null
  const STATS_CHUNK = 500
  const out: RawDebtor[] = []
  let noteColumnMissing = false
  let offset = 0

  while (true) {
    const colsWithNote = `${BASE_COLS}, assignment_note, current_task_id`
    const colsBase = `${BASE_COLS}, current_task_id`

    const build = (cols: string) => {
      let q = supabase
        .from('debtors')
        .select(cols)
        .not('current_task_id', 'is', null)
        .or('case_status.is.null,and(case_status.neq.closed,case_status.neq.payment_in_progress)')
        .order('id')
        .range(offset, offset + STATS_CHUNK - 1)
      if (branchId) q = q.eq('branch_id', branchId)
      if (branchListId) q = q.eq('branch_list_id', branchListId)
      if (caseType) q = q.eq('case_type', caseType)
      if (search) q = q.ilike('full_name', `%${search}%`)
      return q
    }

    let res = await build(colsWithNote)
    if (res.error && isMissingNoteColumnError(res.error.message)) {
      noteColumnMissing = true
      res = await build(colsBase)
    }
    if (res.error) return { rows: [], error: res.error.message, noteColumnMissing }

    const debtors = (res.data ?? []) as unknown as Array<RawDebtor & { current_task_id: string }>
    if (!debtors.length) break

    const taskIds = debtors.map(d => d.current_task_id).filter(Boolean)
    const { data: tasks, error: tErr } = await supabase
      .from('tasks')
      .select('id, task_definition_id, assigned_to, task_status')
      .in('id', taskIds)

    if (tErr) return { rows: [], error: tErr.message, noteColumnMissing }

    const untypedIds = new Set(
      (tasks ?? [])
        .filter(t =>
          !t.task_definition_id
          && !t.assigned_to
          && !TERMINAL_TASK_STATUSES.has(String(t.task_status ?? '')),
        )
        .map(t => t.id),
    )

    for (const d of debtors) {
      if (untypedIds.has(d.current_task_id)) {
        out.push({ ...d, needs_task_definition: true })
      }
    }

    if (debtors.length < STATS_CHUNK) break
    offset += STATS_CHUNK
  }

  return { rows: out, error: null, noteColumnMissing }
}

/** الأقدم أولاً حتى تظهر الحالات المتأخرة في الإسناد قبل غيرها */
export async function fetchAwaitingAssignmentDebtors(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchAwaitingAssignmentOptions,
): Promise<FetchAwaitingAssignmentResult> {
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(100, Math.max(1, options?.limit ?? 50))
  const search = (options?.search ?? '').trim().replace(/[%_,]/g, '')
  const branchListId = options?.branchListId?.trim() || null
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null

  const buildNoTaskQuery = (cols: string) => {
    let q = supabase
      .from('debtors')
      .select(cols)
      .is('current_task_id', null)
      .or('case_status.is.null,and(case_status.neq.closed,case_status.neq.payment_in_progress)')
      .order('created_at', { ascending: true })
    if (branchId) q = q.eq('branch_id', branchId)
    if (branchListId) q = q.eq('branch_list_id', branchListId)
    if (caseType) q = q.eq('case_type', caseType)
    if (search) q = q.ilike('full_name', `%${search}%`)
    return q
  }

  let noteColumnMissing = false

  const untypedRes = await fetchUntypedUnassignedDebtors(supabase, branchId, options)
  if (untypedRes.error) {
    return { rows: [], total: 0, noteColumnMissing: untypedRes.noteColumnMissing, error: untypedRes.error }
  }
  noteColumnMissing = untypedRes.noteColumnMissing
  const untypedSorted = [...untypedRes.rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  let countQ = supabase
    .from('debtors')
    .select('id', { count: 'exact', head: true })
    .is('current_task_id', null)
    .or('case_status.is.null,and(case_status.neq.closed,case_status.neq.payment_in_progress)')
  if (branchId) countQ = countQ.eq('branch_id', branchId)
  if (branchListId) countQ = countQ.eq('branch_list_id', branchListId)
  if (caseType) countQ = countQ.eq('case_type', caseType)
  if (search) countQ = countQ.ilike('full_name', `%${search}%`)
  const { count: noTaskTotal, error: countErr } = await countQ
  if (countErr) {
    return { rows: [], total: 0, noteColumnMissing, error: countErr.message }
  }

  const total = untypedSorted.length + (noTaskTotal ?? 0)
  const page: RawDebtor[] = []

  // untyped أولاً (بحاجة تعيين نوع)، ثم بلا مهمة مطلوبة
  if (offset < untypedSorted.length) {
    page.push(...untypedSorted.slice(offset, offset + limit))
  }
  const remaining = limit - page.length
  if (remaining > 0) {
    const noTaskOffset = Math.max(0, offset - untypedSorted.length)
    let res = await buildNoTaskQuery(`${BASE_COLS}, assignment_note`)
      .range(noTaskOffset, noTaskOffset + remaining - 1)
    if (res.error && isMissingNoteColumnError(res.error.message)) {
      noteColumnMissing = true
      res = await buildNoTaskQuery(BASE_COLS).range(noTaskOffset, noTaskOffset + remaining - 1)
    }
    if (res.error) {
      return { rows: [], total: 0, noteColumnMissing, error: res.error.message }
    }
    const raw = (res.data ?? []) as unknown as RawDebtor[]
    page.push(...raw.map(r => ({ ...r, needs_task_definition: false })))
  }

  const branchNames = await loadBranchNames(supabase, page)
  return {
    rows: mapRows(page, branchNames),
    total,
    noteColumnMissing,
    error: null,
  }
}

export interface AwaitingBranchSummary {
  branchId: string
  branchName: string
  count: number
}

/**
 * فروع تحتوي أسماء تحت إسناد مهمة فقط (لا يُرجع فرعاً بعدد 0).
 * branchId المحدد → ملخص ذلك الفرع إن وُجدت أسماء؛ null → كل الفروع ذات الأسماء.
 */
export async function fetchAwaitingAssignmentBranchSummaries(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: Pick<FetchAwaitingAssignmentOptions, 'search' | 'caseType'>,
): Promise<{ branches: AwaitingBranchSummary[]; error: string | null }> {
  const search = (options?.search ?? '').trim().replace(/[%_,]/g, '')
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null
  const counts = new Map<string, number>()

  const add = (id: string | null | undefined) => {
    if (!id) return
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  // 1) بلا مهمة مطلوبة
  {
    let offset = 0
    const CHUNK = 1000
    while (true) {
      let q = supabase
        .from('debtors')
        .select('branch_id')
        .is('current_task_id', null)
        .or('case_status.is.null,and(case_status.neq.closed,case_status.neq.payment_in_progress)')
        .order('id')
        .range(offset, offset + CHUNK - 1)
      if (branchId) q = q.eq('branch_id', branchId)
      if (caseType) q = q.eq('case_type', caseType)
      if (search) q = q.ilike('full_name', `%${search}%`)
      const { data, error } = await q
      if (error) return { branches: [], error: error.message }
      const rows = data ?? []
      for (const r of rows) add(r.branch_id as string | null)
      if (rows.length < CHUNK) break
      offset += CHUNK
    }
  }

  // 2) مهمة بلا تعريف وغير مكلّفة
  {
    const untyped = await fetchUntypedUnassignedDebtors(supabase, branchId, {
      search,
      caseType,
      branchListId: null,
    })
    if (untyped.error) return { branches: [], error: untyped.error }
    for (const r of untyped.rows) add(r.branch_id)
  }

  const ids = [...counts.entries()].filter(([, n]) => n > 0).map(([id]) => id)
  if (!ids.length) return { branches: [], error: null }

  const { data: branches } = await supabase.from('branches').select('id, name').in('id', ids)
  const nameMap = new Map((branches ?? []).map(b => [b.id as string, b.name as string]))

  const result: AwaitingBranchSummary[] = ids.map(id => ({
    branchId: id,
    branchName: nameMap.get(id) ?? 'فرع',
    count: counts.get(id) ?? 0,
  }))
  result.sort((a, b) => a.branchName.localeCompare(b.branchName, 'ar'))
  return { branches: result, error: null }
}
