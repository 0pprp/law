import type { SupabaseClient } from '@supabase/supabase-js'
import { attachLastNotes } from '@/lib/debtor-last-notes'
import { resolveSpecialStatus } from '@/lib/special-statuses'

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
  court_name: string | null
  execution_office: string | null
  created_at: string
  assignment_note: string | null
  /** عرض آخر ملاحظة بروفايل: «الكاتب: النص...» */
  last_note: string
  case_type: 'civil' | 'criminal'
  /** true إذا كان لديه مهمة حالية بلا تعريف — يحتاج استبدال/تعيين نوع */
  needs_task_definition?: boolean
  /** وقت التحويل لكارد الأسماء المكررة — إن وُجد */
  duplicate_flagged_at?: string | null
  special_status_id?: string | null
  special_status_name?: string | null
  special_status_color?: string | null
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
const BASE_COLS_WITH_COURT =
  'id, full_name, branch_id, branch_list_id, created_at, case_type, notes, court_name, branch_list:branch_lists(name, court_name, execution_office), special_status:special_statuses(id, name, color)'

const BASE_COLS_NO_COURT =
  'id, full_name, branch_id, branch_list_id, created_at, case_type, notes, branch_list:branch_lists(name, court_name, execution_office), special_status:special_statuses(id, name, color)'

let awaitingCourtColReady: boolean | null = null

function isMissingDebtorCourtCol(message: string | undefined | null): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return m.includes('court_name') && (m.includes('debtors') || m.includes('column') || m.includes('schema cache'))
}

function awaitingBaseCols(): string {
  return awaitingCourtColReady === false ? BASE_COLS_NO_COURT : BASE_COLS_WITH_COURT
}

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

function isMissingDuplicateColumnError(message: string | undefined | null): boolean {
  return !!message && message.includes('duplicate_flagged_at')
}

/** يستثني المحوّلين للأسماء المكررة — يتجاهل الشرط إن العمود غير مطبّق بعد */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyNotDuplicateFilter(q: any, columnReady: boolean): any {
  if (!columnReady) return q
  return q.is('duplicate_flagged_at', null)
}

/**
 * قائمة الفرع تخص المدني فقط.
 * الجزائيون عادةً branch_list_id IS NULL — فلتر القائمة كان يخفيهم بالكامل.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyAwaitingBranchListFilter(
  q: any,
  branchListId: string | null | undefined,
  caseType: 'civil' | 'criminal' | null,
): any {
  const listId = typeof branchListId === 'string' ? branchListId.trim() : ''
  if (!listId) return q
  if (caseType === 'criminal') return q
  if (caseType === 'civil') return q.eq('branch_list_id', listId)
  // الكل: مدنيو القائمة + جزائيون بلا قائمة
  return q.or(`branch_list_id.eq.${listId},and(case_type.eq.criminal,branch_list_id.is.null)`)
}

/** حالة مفتوحة للإسناد: active أو null — يستثني closed و payment_in_progress */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyAwaitingCaseStatusFilter(q: any): any {
  return q.or('case_status.is.null,case_status.eq.active,and(case_status.neq.closed,case_status.neq.payment_in_progress)')
}

type BranchListEmbed =
  | { name?: string | null; court_name?: string | null; execution_office?: string | null }
  | { name?: string | null; court_name?: string | null; execution_office?: string | null }[]
  | null
  | undefined

function embedRow(embed: BranchListEmbed) {
  if (!embed) return null
  return Array.isArray(embed) ? embed[0] : embed
}

/** يستخرج اسم القائمة من embed PostgREST بأمان (كائن أو مصفوفة أو null) */
export function resolveBranchListName(embed: BranchListEmbed): string | null {
  const name = embedRow(embed)?.name?.trim()
  return name || null
}

export function resolveCourtName(embed: BranchListEmbed): string | null {
  const v = embedRow(embed)?.court_name?.trim()
  return v || null
}

export function resolveExecutionOffice(embed: BranchListEmbed): string | null {
  const v = embedRow(embed)?.execution_office?.trim()
  return v || null
}

/**
 * محكمة المدين المعروضة:
 * 1) court_name على المدين إن وُجد (حالة استثنائية)
 * 2) وإلا محكمة القائمة المرتبطة
 */
export function resolveDebtorCourtName(debtor: {
  court_name?: string | null
  branch_list?: BranchListEmbed
}): string | null {
  const override = typeof debtor.court_name === 'string' ? debtor.court_name.trim() : ''
  if (override) return override
  return resolveCourtName(debtor.branch_list)
}

type RawDebtor = {
  id: string
  full_name: string | null
  branch_id: string | null
  branch_list_id?: string | null
  court_name?: string | null
  branch_list?: BranchListEmbed
  created_at: string
  case_type?: string | null
  assignment_note?: string | null
  notes?: string | null
  needs_task_definition?: boolean
  duplicate_flagged_at?: string | null
  special_status?: { id?: string; name?: string | null; color?: string | null } | { id?: string; name?: string | null; color?: string | null }[] | null
}

async function mapRowsWithLastNotes(
  supabase: SupabaseClient,
  raw: RawDebtor[],
  branchNames: Map<string, string>,
): Promise<AwaitingAssignmentDebtor[]> {
  const mapped = raw.map(r => {
    const ss = resolveSpecialStatus(r.special_status)
    return {
    id: r.id,
    full_name: r.full_name ?? '—',
    branch_id: r.branch_id,
    branch_name: r.branch_id ? branchNames.get(r.branch_id) ?? null : null,
    branch_list_id: r.branch_list_id ?? null,
    branch_list_name: resolveBranchListName(r.branch_list),
    court_name: resolveDebtorCourtName(r),
    execution_office: resolveExecutionOffice(r.branch_list),
    created_at: r.created_at,
    assignment_note: r.assignment_note ?? null,
    last_note: '—' as string,
    notes: r.notes ?? null,
    case_type: (r.case_type === 'criminal' ? 'criminal' : 'civil') as 'civil' | 'criminal',
    needs_task_definition: Boolean(r.needs_task_definition),
    duplicate_flagged_at: r.duplicate_flagged_at ?? null,
    special_status_id: ss.id,
    special_status_name: ss.name,
    special_status_color: ss.color,
  }})
  const withNotes = await attachLastNotes(supabase, mapped)
  return withNotes.map(({ notes: _notes, ...rest }) => rest)
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
 * فلترة على الـ join بدل مسح كل المدينين ثم التصفية محلياً.
 */
async function fetchUntypedUnassignedDebtors(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchAwaitingAssignmentOptions,
): Promise<{ rows: RawDebtor[]; error: string | null; noteColumnMissing: boolean }> {
  const search = (options?.search ?? '').trim().replace(/[%_,]/g, '')
  const branchListId = options?.branchListId?.trim() || null
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null
  const PAGE = 500
  const terminalFilter = `(${[...TERMINAL_TASK_STATUSES].join(',')})`
  let noteColumnMissing = false
  let duplicateColumnReady = true

  const colsWithNote = `${awaitingBaseCols()}, assignment_note, current_task_id`
  const colsBase = `${awaitingBaseCols()}, current_task_id`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const build = (cols: string, from: number, to: number): any => {
    let q = supabase
      .from('debtors')
      .select(`${cols}, current_task:tasks!current_task_id!inner(id, task_definition_id, assigned_to, task_status)`)
      .is('special_status_id', null)
    q = applyAwaitingCaseStatusFilter(q)
      .is('current_task.task_definition_id', null)
      .is('current_task.assigned_to', null)
      .not('current_task.task_status', 'in', terminalFilter)
      .order('id')
      .range(from, to)
    if (branchId) q = q.eq('branch_id', branchId)
    q = applyAwaitingBranchListFilter(q, branchListId, caseType)
    if (caseType) q = q.eq('case_type', caseType)
    if (search) q = q.ilike('full_name', `%${search}%`)
    q = applyNotDuplicateFilter(q, duplicateColumnReady)
    return q
  }

  async function runPage(from: number, to: number) {
    let res = await build(colsWithNote, from, to)
    if (res.error && isMissingDuplicateColumnError(res.error.message)) {
      duplicateColumnReady = false
      res = await build(colsWithNote, from, to)
    }
    if (res.error && isMissingDebtorCourtCol(res.error.message) && awaitingCourtColReady !== false) {
      awaitingCourtColReady = false
      res = await build(`${awaitingBaseCols()}, assignment_note, current_task_id`, from, to)
    }
    if (res.error && isMissingNoteColumnError(res.error.message)) {
      noteColumnMissing = true
      res = await build(`${awaitingBaseCols()}, current_task_id`, from, to)
      if (res.error && isMissingDuplicateColumnError(res.error.message)) {
        duplicateColumnReady = false
        res = await build(`${awaitingBaseCols()}, current_task_id`, from, to)
      }
    } else if (!res.error && awaitingCourtColReady !== false) {
      awaitingCourtColReady = true
    }
    return res
  }

  const first = await runPage(0, PAGE - 1)
  if (first.error) return { rows: [], error: first.error.message, noteColumnMissing }

  const firstRows = (first.data ?? []) as unknown as RawDebtor[]
  const out: RawDebtor[] = firstRows.map(r => ({ ...r, needs_task_definition: true }))

  // إن تجاوزت الصفحة الأولى: صفحات متوازية بدل while متسلسل
  if (firstRows.length >= PAGE) {
    const extraPages = 3
    const results = await Promise.all(
      Array.from({ length: extraPages }, (_, i) => {
        const from = (i + 1) * PAGE
        return runPage(from, from + PAGE - 1)
      }),
    )
    for (const res of results) {
      if (res.error) return { rows: [], error: res.error.message, noteColumnMissing }
      const rows = (res.data ?? []) as unknown as RawDebtor[]
      for (const r of rows) out.push({ ...r, needs_task_definition: true })
      if (rows.length < PAGE) break
    }
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
  // حد أعلى مرتفع لزر «عرض الكل» — الصفحة الأولى تبقى صغيرة من الواجهة
  const limit = Math.min(5000, Math.max(1, options?.limit ?? 50))
  const search = (options?.search ?? '').trim().replace(/[%_,]/g, '')
  const branchListId = options?.branchListId?.trim() || null
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null

  let duplicateColumnReady = true

  const buildNoTaskQuery = (cols: string) => {
    let q = supabase
      .from('debtors')
      .select(cols)
      .is('current_task_id', null)
      .is('special_status_id', null)
    q = applyAwaitingCaseStatusFilter(q)
      .order('created_at', { ascending: true })
    if (branchId) q = q.eq('branch_id', branchId)
    q = applyAwaitingBranchListFilter(q, branchListId, caseType)
    if (caseType) q = q.eq('case_type', caseType)
    if (search) q = q.ilike('full_name', `%${search}%`)
    q = applyNotDuplicateFilter(q, duplicateColumnReady)
    return q
  }

  let noteColumnMissing = false

  const untypedRes = await fetchUntypedUnassignedDebtors(supabase, branchId, options)
  if (untypedRes.error) {
    // لا تُصفَّر أسماء بلا مهمة بسبب فشل مسار المهام اليتيمة
    console.warn('[fetchAwaitingAssignmentDebtors] untyped scan skipped:', untypedRes.error)
  }
  noteColumnMissing = untypedRes.noteColumnMissing
  const untypedSorted = untypedRes.error
    ? []
    : [...untypedRes.rows].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )

  let countQ = supabase
    .from('debtors')
    .select('id', { count: 'exact', head: true })
    .is('current_task_id', null)
    .is('special_status_id', null)
  countQ = applyAwaitingCaseStatusFilter(countQ)
  if (branchId) countQ = countQ.eq('branch_id', branchId)
  countQ = applyAwaitingBranchListFilter(countQ, branchListId, caseType)
  if (caseType) countQ = countQ.eq('case_type', caseType)
  if (search) countQ = countQ.ilike('full_name', `%${search}%`)
  countQ = applyNotDuplicateFilter(countQ, duplicateColumnReady)
  let { count: noTaskTotal, error: countErr } = await countQ
  if (countErr && isMissingDuplicateColumnError(countErr.message)) {
    duplicateColumnReady = false
    countQ = supabase
      .from('debtors')
      .select('id', { count: 'exact', head: true })
      .is('current_task_id', null)
      .is('special_status_id', null)
    countQ = applyAwaitingCaseStatusFilter(countQ)
    if (branchId) countQ = countQ.eq('branch_id', branchId)
    countQ = applyAwaitingBranchListFilter(countQ, branchListId, caseType)
    if (caseType) countQ = countQ.eq('case_type', caseType)
    if (search) countQ = countQ.ilike('full_name', `%${search}%`)
    ;({ count: noTaskTotal, error: countErr } = await countQ)
  }
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
    let res = await buildNoTaskQuery(`${awaitingBaseCols()}, assignment_note`)
      .range(noTaskOffset, noTaskOffset + remaining - 1)
    if (res.error && isMissingDuplicateColumnError(res.error.message)) {
      duplicateColumnReady = false
      res = await buildNoTaskQuery(`${awaitingBaseCols()}, assignment_note`)
        .range(noTaskOffset, noTaskOffset + remaining - 1)
    }
    if (res.error && isMissingDebtorCourtCol(res.error.message) && awaitingCourtColReady !== false) {
      awaitingCourtColReady = false
      res = await buildNoTaskQuery(`${awaitingBaseCols()}, assignment_note`)
        .range(noTaskOffset, noTaskOffset + remaining - 1)
    }
    if (res.error && isMissingNoteColumnError(res.error.message)) {
      noteColumnMissing = true
      res = await buildNoTaskQuery(awaitingBaseCols()).range(noTaskOffset, noTaskOffset + remaining - 1)
      if (res.error && isMissingDuplicateColumnError(res.error.message)) {
        duplicateColumnReady = false
        res = await buildNoTaskQuery(awaitingBaseCols()).range(noTaskOffset, noTaskOffset + remaining - 1)
      }
      if (res.error && isMissingDebtorCourtCol(res.error.message) && awaitingCourtColReady !== false) {
        awaitingCourtColReady = false
        res = await buildNoTaskQuery(awaitingBaseCols()).range(noTaskOffset, noTaskOffset + remaining - 1)
      }
    } else if (!res.error && awaitingCourtColReady !== false) {
      awaitingCourtColReady = true
    }
    if (res.error) {
      return { rows: [], total: 0, noteColumnMissing, error: res.error.message }
    }
    const raw = (res.data ?? []) as unknown as RawDebtor[]
    page.push(...raw.map(r => ({ ...r, needs_task_definition: false })))
  }

  const branchNames = await loadBranchNames(supabase, page)
  return {
    rows: await mapRowsWithLastNotes(supabase, page, branchNames),
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

async function countNoTaskAwaiting(
  supabase: SupabaseClient,
  branchId: string,
  search: string,
  caseType: 'civil' | 'criminal' | null,
  duplicateColumnReady: boolean,
): Promise<{ count: number; error: string | null; duplicateColumnReady: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const build = (dupReady: boolean): any => {
    let q = supabase
      .from('debtors')
      .select('id', { count: 'exact', head: true })
      .is('current_task_id', null)
      .is('special_status_id', null)
    q = applyAwaitingCaseStatusFilter(q)
      .eq('branch_id', branchId)
    if (caseType) q = q.eq('case_type', caseType)
    if (search) q = q.ilike('full_name', `%${search}%`)
    q = applyNotDuplicateFilter(q, dupReady)
    return q
  }

  let ready = duplicateColumnReady
  let res = await build(ready)
  if (res.error && isMissingDuplicateColumnError(res.error.message)) {
    ready = false
    res = await build(false)
  }
  if (res.error) return { count: 0, error: res.error.message, duplicateColumnReady: ready }
  return { count: res.count ?? 0, error: null, duplicateColumnReady: ready }
}

async function countUntypedAwaiting(
  supabase: SupabaseClient,
  branchId: string,
  search: string,
  caseType: 'civil' | 'criminal' | null,
  duplicateColumnReady: boolean,
): Promise<{ count: number; error: string | null; duplicateColumnReady: boolean }> {
  const terminalFilter = `(${[...TERMINAL_TASK_STATUSES].join(',')})`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const build = (dupReady: boolean): any => {
    let q = supabase
      .from('debtors')
      .select('id, current_task:tasks!current_task_id!inner(id)', { count: 'exact', head: true })
      .is('special_status_id', null)
    q = applyAwaitingCaseStatusFilter(q)
      .eq('branch_id', branchId)
      .is('current_task.task_definition_id', null)
      .is('current_task.assigned_to', null)
      .not('current_task.task_status', 'in', terminalFilter)
    if (caseType) q = q.eq('case_type', caseType)
    if (search) q = q.ilike('full_name', `%${search}%`)
    q = applyNotDuplicateFilter(q, dupReady)
    return q
  }

  let ready = duplicateColumnReady
  let res = await build(ready)
  if (res.error && isMissingDuplicateColumnError(res.error.message)) {
    ready = false
    res = await build(false)
  }
  if (res.error) return { count: 0, error: res.error.message, duplicateColumnReady: ready }
  return { count: res.count ?? 0, error: null, duplicateColumnReady: ready }
}

/**
 * فروع تحتوي أسماء تحت إسناد مهمة فقط (لا يُرجع فرعاً بعدد 0).
 * branchId المحدد → ملخص ذلك الفرع؛ null (الكل) → كل الفروع النشطة ثم عدّاد لكل فرع.
 */
export async function fetchAwaitingAssignmentBranchSummaries(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: Pick<FetchAwaitingAssignmentOptions, 'search' | 'caseType'>,
): Promise<{ branches: AwaitingBranchSummary[]; error: string | null }> {
  try {
    const search = (options?.search ?? '').trim().replace(/[%_,]/g, '')
    const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null

    let branchRows: { id: string; name: string }[] = []
    if (branchId) {
      const { data, error } = await supabase
        .from('branches')
        .select('id, name')
        .eq('id', branchId)
        .maybeSingle()
      if (error) return { branches: [], error: error.message || 'فشل تحميل الفرع' }
      if (data) branchRows = [{ id: data.id, name: data.name }]
    } else {
      const { fetchSelectableBranches } = await import('@/lib/branches-cache')
      branchRows = await fetchSelectableBranches(supabase)
      if (!branchRows.length) {
        const { data, error } = await supabase
          .from('branches')
          .select('id, name')
          .eq('is_active', true)
          .order('name')
        if (error) return { branches: [], error: error.message || 'فشل تحميل الفروع' }
        branchRows = (data ?? []).map(b => ({ id: b.id as string, name: b.name as string }))
      }
    }

    if (!branchRows.length) return { branches: [], error: null }

    let duplicateColumnReady = true
    const summaries: AwaitingBranchSummary[] = []

    // دفعات متوازية لتفادي ضغط الشبكة عند «الكل»
    const BATCH = 6
    for (let i = 0; i < branchRows.length; i += BATCH) {
      const chunk = branchRows.slice(i, i + BATCH)
      const counted = await Promise.all(
        chunk.map(async b => {
          const noTask = await countNoTaskAwaiting(supabase, b.id, search, caseType, duplicateColumnReady)
          if (noTask.error) return { error: noTask.error as string | null, summary: null as AwaitingBranchSummary | null }
          duplicateColumnReady = noTask.duplicateColumnReady
          const untyped = await countUntypedAwaiting(supabase, b.id, search, caseType, duplicateColumnReady)
          if (untyped.error) return { error: untyped.error as string | null, summary: null as AwaitingBranchSummary | null }
          duplicateColumnReady = untyped.duplicateColumnReady
          const count = noTask.count + untyped.count
          if (count <= 0) return { error: null, summary: null }
          return {
            error: null,
            summary: { branchId: b.id, branchName: b.name, count },
          }
        }),
      )
      for (const row of counted) {
        if (row.error) return { branches: [], error: row.error }
        if (row.summary) summaries.push(row.summary)
      }
    }

    summaries.sort((a, b) => a.branchName.localeCompare(b.branchName, 'ar'))
    return { branches: summaries, error: null }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'فشل تحميل الفروع'
    console.error('[fetchAwaitingAssignmentBranchSummaries]', msg)
    return { branches: [], error: msg }
  }
}
