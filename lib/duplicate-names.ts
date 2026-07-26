import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type AwaitingAssignmentDebtor,
  type AwaitingBranchSummary,
  type FetchAwaitingAssignmentOptions,
  type FetchAwaitingAssignmentResult,
  resolveBranchListName,
} from '@/lib/awaiting-assignment'
import { attachLastNotes } from '@/lib/debtor-last-notes'

const BASE_COLS =
  'id, full_name, branch_id, branch_list_id, created_at, case_type, notes, branch_list:branch_lists(name)'

function isMissingNoteColumnError(message: string | undefined | null): boolean {
  return !!message && message.includes('assignment_note')
}

function isMissingDuplicateColumnError(message: string | undefined | null): boolean {
  return !!message && (
    message.includes('duplicate_flagged_at') || message.includes('duplicate_flagged_by')
  )
}

type BranchListEmbed = { name?: string | null } | { name?: string | null }[] | null | undefined

type RawDebtor = {
  id: string
  full_name: string | null
  branch_id: string | null
  branch_list_id?: string | null
  branch_list?: BranchListEmbed
  created_at: string
  case_type?: string | null
  assignment_note?: string | null
  notes?: string | null
  duplicate_flagged_at?: string | null
}

async function mapRowsWithLastNotes(
  supabase: SupabaseClient,
  raw: RawDebtor[],
  branchNames: Map<string, string>,
): Promise<AwaitingAssignmentDebtor[]> {
  const mapped = raw.map(r => ({
    id: r.id,
    full_name: r.full_name ?? '—',
    branch_id: r.branch_id,
    branch_name: r.branch_id ? branchNames.get(r.branch_id) ?? null : null,
    branch_list_id: r.branch_list_id ?? null,
    branch_list_name: resolveBranchListName(r.branch_list),
    created_at: r.created_at,
    assignment_note: r.assignment_note ?? null,
    last_note: '—' as string,
    notes: r.notes ?? null,
    case_type: (r.case_type === 'criminal' ? 'criminal' : 'civil') as 'civil' | 'criminal',
    duplicate_flagged_at: r.duplicate_flagged_at ?? null,
  }))
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
 * مدينون محوّلون لكارد «الأسماء المكررة» (duplicate_flagged_at IS NOT NULL).
 */
export async function fetchDuplicateNamesDebtors(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: FetchAwaitingAssignmentOptions,
): Promise<FetchAwaitingAssignmentResult> {
  const offset = Math.max(0, options?.offset ?? 0)
  const limit = Math.min(5000, Math.max(1, options?.limit ?? 50))
  const search = (options?.search ?? '').trim().replace(/[%_,]/g, '')
  const branchListId = options?.branchListId?.trim() || null
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null

  const buildQuery = (cols: string) => {
    let q = supabase
      .from('debtors')
      .select(cols, { count: 'exact' })
      .not('duplicate_flagged_at', 'is', null)
      .or('case_status.is.null,and(case_status.neq.closed,case_status.neq.payment_in_progress)')
      .order('duplicate_flagged_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (branchId) q = q.eq('branch_id', branchId)
    if (branchListId) q = q.eq('branch_list_id', branchListId)
    if (caseType) q = q.eq('case_type', caseType)
    if (search) q = q.ilike('full_name', `%${search}%`)
    return q
  }

  let noteColumnMissing = false
  let res = await buildQuery(`${BASE_COLS}, assignment_note, duplicate_flagged_at`)
  if (res.error && isMissingDuplicateColumnError(res.error.message)) {
    return {
      rows: [],
      total: 0,
      noteColumnMissing: false,
      error: 'عمود الأسماء المكررة غير مفعّل بعد — شغّل supabase/scripts/apply-debtor-duplicate-flag.sql',
    }
  }
  if (res.error && isMissingNoteColumnError(res.error.message)) {
    noteColumnMissing = true
    res = await buildQuery(`${BASE_COLS}, duplicate_flagged_at`)
  }
  if (res.error) {
    return { rows: [], total: 0, noteColumnMissing, error: res.error.message }
  }

  const raw = (res.data ?? []) as unknown as RawDebtor[]
  const branchNames = await loadBranchNames(supabase, raw)
  return {
    rows: await mapRowsWithLastNotes(supabase, raw, branchNames),
    total: res.count ?? raw.length,
    noteColumnMissing,
    error: null,
  }
}

/**
 * ملخص فروع تحتوي أسماء مكررة فقط.
 */
export async function fetchDuplicateNamesBranchSummaries(
  supabase: SupabaseClient,
  branchId: string | null,
  options?: Pick<FetchAwaitingAssignmentOptions, 'search' | 'caseType'>,
): Promise<{ branches: AwaitingBranchSummary[]; error: string | null }> {
  const search = (options?.search ?? '').trim().replace(/[%_,]/g, '')
  const caseType = options?.caseType === 'civil' || options?.caseType === 'criminal' ? options.caseType : null
  const counts = new Map<string, number>()

  let offset = 0
  const CHUNK = 1000
  while (true) {
    let q = supabase
      .from('debtors')
      .select('branch_id')
      .not('duplicate_flagged_at', 'is', null)
      .or('case_status.is.null,and(case_status.neq.closed,case_status.neq.payment_in_progress)')
      .order('id')
      .range(offset, offset + CHUNK - 1)
    if (branchId) q = q.eq('branch_id', branchId)
    if (caseType) q = q.eq('case_type', caseType)
    if (search) q = q.ilike('full_name', `%${search}%`)
    const { data, error } = await q
    if (error) {
      if (isMissingDuplicateColumnError(error.message)) {
        return { branches: [], error: null }
      }
      return { branches: [], error: error.message }
    }
    const rows = data ?? []
    for (const r of rows) {
      const id = r.branch_id as string | null
      if (!id) continue
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    if (rows.length < CHUNK) break
    offset += CHUNK
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
