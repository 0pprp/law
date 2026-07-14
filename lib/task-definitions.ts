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

function taskDefLabelKey(label: string | null | undefined, fallbackId: string): string {
  const key = (label ?? '').trim().toLowerCase()
  return key || fallbackId
}

/** واجهة فلترة «الكل»: خيار واحد لكل اسم مهمة (بدون تكرار بين الفروع). */
export function dedupeTaskDefinitionsByLabel<T extends { id: string; label?: string | null }>(
  defs: T[],
): T[] {
  const seen = new Map<string, T>()
  for (const d of defs) {
    const key = taskDefLabelKey(d.label, d.id)
    if (!seen.has(key)) seen.set(key, d)
  }
  return [...seen.values()]
}

/** عند الفلترة بوضع «الكل»: كل معرّفات التعريفات التي تحمل نفس الاسم. */
export function expandTaskDefinitionIdsByLabel(
  defs: { id: string; label?: string | null }[],
  selectedId: string,
): string[] {
  if (!selectedId) return []
  const selected = defs.find(d => d.id === selectedId)
  if (!selected) return [selectedId]
  const key = taskDefLabelKey(selected.label, selected.id)
  const ids = defs.filter(d => taskDefLabelKey(d.label, d.id) === key).map(d => d.id)
  return ids.length ? ids : [selectedId]
}
