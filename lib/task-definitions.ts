import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Active task definitions for the current branch.
 * Each branch has its own copy (~19 types); without branch_id you get duplicates across branches.
 */
export async function fetchActiveTaskDefinitions<T extends string = 'id, label, sort_order'>(
  supabase: SupabaseClient,
  branchId: string | null,
  select: T = 'id, label, sort_order' as T,
): Promise<Record<string, unknown>[]> {
  let q = supabase
    .from('task_definitions')
    .select(select)
    .eq('is_active', true)
    .order('sort_order')
  if (branchId) q = q.eq('branch_id', branchId)

  const { data, error } = await q

  if (error) console.error('[fetchActiveTaskDefinitions]', error.message)
  return (data ?? []) as Record<string, unknown>[]
}
