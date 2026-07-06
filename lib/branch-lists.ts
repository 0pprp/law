import type { SupabaseClient } from '@supabase/supabase-js'

export interface BranchList {
  id: string
  branch_id: string
  name: string
  created_at: string
  updated_at: string
}

export function sortBranchListsByName<T extends { name: string }>(lists: T[]): T[] {
  return [...lists].sort((a, b) => a.name.localeCompare(b.name, 'ar'))
}

export async function fetchBranchLists(
  supabase: SupabaseClient,
  branchId: string,
): Promise<BranchList[]> {
  const { data, error } = await supabase
    .from('branch_lists')
    .select('id, branch_id, name, created_at, updated_at')
    .eq('branch_id', branchId)
    .order('name')

  if (error) {
    console.error('[fetchBranchLists]', error.message)
    return []
  }
  return sortBranchListsByName(data ?? [])
}

export async function countDebtorsOnBranchList(
  supabase: SupabaseClient,
  listId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('debtors')
    .select('id', { count: 'exact', head: true })
    .eq('branch_list_id', listId)

  if (error) {
    console.error('[countDebtorsOnBranchList]', error.message)
    return 0
  }
  return count ?? 0
}

export async function unlinkDebtorsFromBranchList(
  supabase: SupabaseClient,
  listId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('debtors')
    .update({ branch_list_id: null })
    .eq('branch_list_id', listId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** إيجاد قائمة بالاسم أو إنشاؤها داخل الفرع (للاستيراد) */
export async function findOrCreateBranchList(
  supabase: SupabaseClient,
  branchId: string,
  rawName: string,
): Promise<{ id: string; name: string } | null> {
  const name = rawName.trim()
  if (!name) return null

  const { data: existing } = await supabase
    .from('branch_lists')
    .select('id, name')
    .eq('branch_id', branchId)
    .eq('name', name)
    .maybeSingle()

  if (existing) return existing

  const { data: created, error } = await supabase
    .from('branch_lists')
    .insert({ branch_id: branchId, name })
    .select('id, name')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: retry } = await supabase
        .from('branch_lists')
        .select('id, name')
        .eq('branch_id', branchId)
        .eq('name', name)
        .maybeSingle()
      return retry ?? null
    }
    console.error('[findOrCreateBranchList]', error.message)
    return null
  }
  return created
}

export async function resolveDebtorIdsByBranchList(
  supabase: SupabaseClient,
  branchId: string,
  branchListId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('debtors')
    .select('id')
    .eq('branch_id', branchId)
    .eq('branch_list_id', branchListId)

  if (error) {
    console.error('[resolveDebtorIdsByBranchList]', error.message)
    return []
  }
  return (data ?? []).map(d => d.id)
}
