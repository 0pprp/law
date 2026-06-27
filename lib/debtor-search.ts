import type { SupabaseClient } from '@supabase/supabase-js'

/** Shared debtor search: name, phone, receipt number (رقم الوصل). */

export type DebtorSearchFields = {
  full_name?: string | null
  phone?: string | null
  receipt_number?: string | null
}

export type DebtorSearchRow = DebtorSearchFields & {
  id: string
  governorate?: string | null
}

export const DEBTOR_SEARCH_PLACEHOLDER = 'بحث بالاسم أو الهاتف أو رقم الوصل...'

export const DEBTOR_SELECT_SEARCH_PLACEHOLDER = DEBTOR_SEARCH_PLACEHOLDER

export const DEBTOR_SEARCH_MIN_CHARS = 1

export const DEBTOR_SEARCH_RESULT_LIMIT = 25

export const DEBTOR_DEFAULT_SELECT =
  'id, full_name, phone, receipt_number, governorate'

export const DEBTOR_TASK_SELECT =
  'id, full_name, phone, governorate, receipt_type, receipt_number, remaining_amount, required_amount, has_contract, case_status, current_task_id'

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

export function normalizeDebtorSearchQuery(query: string): string {
  return query.trim().toLowerCase()
}

export function debtorMatchesSearch(debtor: DebtorSearchFields, query: string): boolean {
  const q = normalizeDebtorSearchQuery(query)
  if (!q) return true

  const name = (debtor.full_name ?? '').toLowerCase()
  const phone = (debtor.phone ?? '').toLowerCase()
  const receipt = (debtor.receipt_number ?? '').toLowerCase()
  const qDigits = digitsOnly(q)

  if (name.includes(q)) return true
  if (phone.includes(q)) return true
  if (qDigits && digitsOnly(phone).includes(qDigits)) return true
  if (receipt.includes(q)) return true
  if (qDigits && digitsOnly(receipt).includes(qDigits)) return true

  return false
}

/** Supabase `.or()` filter for server-side debtor search. */
export function debtorSearchOrFilter(term: string): string {
  const s = term.trim()
  return `full_name.ilike.%${s}%,phone.ilike.%${s}%,receipt_number.ilike.%${s}%`
}

export function debtorSelectHint(
  debtor: DebtorSearchFields & { governorate?: string | null },
): string | undefined {
  const parts = [debtor.phone, debtor.receipt_number, debtor.governorate].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

export function debtorSelectOption(
  debtor: { id: string } & DebtorSearchFields & { governorate?: string | null },
) {
  return {
    value: debtor.id,
    label: debtor.full_name ?? '—',
    hint: debtorSelectHint(debtor),
  }
}

export interface FetchDebtorsBySearchOptions {
  branchId?: string | null
  limit?: number
  select?: string
}

/** Server-side debtor search — does not load the full list. */
export async function fetchDebtorsBySearch(
  supabase: SupabaseClient,
  term: string,
  options?: FetchDebtorsBySearchOptions,
): Promise<DebtorSearchRow[]> {
  const trimmed = term.trim()
  if (trimmed.length < DEBTOR_SEARCH_MIN_CHARS) return []

  let q = supabase
    .from('debtors')
    .select(options?.select ?? DEBTOR_DEFAULT_SELECT)
    .or(debtorSearchOrFilter(trimmed))
    .order('full_name')
    .limit(options?.limit ?? DEBTOR_SEARCH_RESULT_LIMIT)

  if (options?.branchId) q = (q as any).eq('branch_id', options.branchId)

  const { data, error } = await q
  if (error) {
    console.error('[fetchDebtorsBySearch]', error.message ?? error)
    return []
  }
  return (data ?? []) as DebtorSearchRow[]
}

export async function fetchDebtorById(
  supabase: SupabaseClient,
  id: string,
  options?: FetchDebtorsBySearchOptions,
): Promise<DebtorSearchRow | null> {
  if (!id) return null

  let q = supabase
    .from('debtors')
    .select(options?.select ?? DEBTOR_DEFAULT_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (options?.branchId) q = (q as any).eq('branch_id', options.branchId)

  const { data, error } = await q
  if (error) {
    console.error('[fetchDebtorById]', error.message ?? error)
    return null
  }
  return (data as DebtorSearchRow | null) ?? null
}

/** Returns debtor IDs matching search, or null when term is empty (no filter). */
export async function resolveDebtorIdsBySearch(
  supabase: SupabaseClient,
  term: string,
  branchId?: string | null,
  limit = 200,
): Promise<string[] | null> {
  if (!term.trim()) return null
  const rows = await fetchDebtorsBySearch(supabase, term, { branchId, limit })
  return rows.map(r => r.id)
}
