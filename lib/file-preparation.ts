import type { SupabaseClient } from '@supabase/supabase-js'

function isMissingPrepColumn(message: string | undefined | null): boolean {
  if (!message) return false
  const m = message.toLowerCase()
  return m.includes('file_preparation_status') && (m.includes('column') || m.includes('schema cache'))
}

/**
 * عدد المدينين قيد تجهيز الملفات (file_preparation_status = preparing).
 */
export async function countFilePreparationDebtors(
  supabase: SupabaseClient,
  branchId: string | null,
  opts?: {
    branchListId?: string | null
    caseType?: 'civil' | 'criminal' | null
  },
): Promise<number> {
  const listId = opts?.branchListId?.trim() || null
  const caseType = opts?.caseType === 'civil' || opts?.caseType === 'criminal' ? opts.caseType : null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const build = (): any => {
    let q = supabase
      .from('debtors')
      .select('id', { count: 'exact', head: true })
      .eq('file_preparation_status', 'preparing')
    if (branchId) q = q.eq('branch_id', branchId)
    if (caseType) q = q.eq('case_type', caseType)
    if (listId && caseType !== 'criminal') {
      if (caseType === 'civil') q = q.eq('branch_list_id', listId)
      else q = q.or(`branch_list_id.eq.${listId},and(case_type.eq.criminal,branch_list_id.is.null)`)
    }
    return q
  }

  const { count, error } = await build()
  if (error) {
    if (isMissingPrepColumn(error.message)) return 0
    console.warn('[countFilePreparationDebtors]', error.message)
    return 0
  }
  return count ?? 0
}
