import type { SupabaseClient } from '@supabase/supabase-js'
import {
  normalizeBranchListName,
  preferBranchListDisplayName,
  sanitizeBranchListDisplayName,
} from '@/lib/branch-list-normalize'

export interface BranchList {
  id: string
  branch_id: string
  name: string
  normalized_name?: string | null
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
    .select('id, branch_id, name, normalized_name, created_at, updated_at')
    .eq('branch_id', branchId)
    .order('name')

  if (error) {
    // عمود normalized_name قد لا يكون مطبّقاً بعد
    if (String(error.message ?? '').includes('normalized_name')) {
      const fallback = await supabase
        .from('branch_lists')
        .select('id, branch_id, name, created_at, updated_at')
        .eq('branch_id', branchId)
        .order('name')
      if (fallback.error) {
        console.error('[fetchBranchLists]', fallback.error.message)
        return []
      }
      return sortBranchListsByName(fallback.data ?? [])
    }
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

async function findListByNormalized(
  supabase: SupabaseClient,
  branchId: string,
  key: string,
  excludeId?: string,
): Promise<{ id: string; name: string } | null> {
  if (!key) return null

  // محاولة بالعمود إن وُجد
  let q = supabase
    .from('branch_lists')
    .select('id, name, normalized_name')
    .eq('branch_id', branchId)
    .eq('normalized_name', key)
  if (excludeId) q = q.neq('id', excludeId)
  const byCol = await q.maybeSingle()
  if (!byCol.error && byCol.data) return { id: byCol.data.id, name: byCol.data.name }

  // احتياطي: مقارنة في الذاكرة
  const { data: lists, error } = await supabase
    .from('branch_lists')
    .select('id, name')
    .eq('branch_id', branchId)
  if (error) {
    console.error('[findListByNormalized]', error.message)
    return null
  }
  const hit = (lists ?? []).find(
    l => (!excludeId || l.id !== excludeId) && normalizeBranchListName(l.name) === key,
  )
  return hit ? { id: hit.id, name: hit.name } : null
}

/**
 * إيجاد قائمة بالاسم المطبع أو إنشاؤها داخل الفرع (للاستيراد والإضافة).
 * لا ينشئ مكرراً بسبب الهمزة / ال / المسافات / الأرقام.
 */
export async function findOrCreateBranchList(
  supabase: SupabaseClient,
  branchId: string,
  rawName: string,
): Promise<{ id: string; name: string } | null> {
  const displayName = sanitizeBranchListDisplayName(rawName)
  if (!displayName) return null
  const key = normalizeBranchListName(displayName)
  if (!key) return null

  const existing = await findListByNormalized(supabase, branchId, key)
  if (existing) return existing

  const payload: Record<string, unknown> = {
    branch_id: branchId,
    name: displayName,
    normalized_name: key,
  }

  const { data: created, error } = await supabase
    .from('branch_lists')
    .insert(payload)
    .select('id, name')
    .single()

  if (error) {
    if (String(error.message ?? '').includes('normalized_name')) {
      const { data: createdLegacy, error: legacyErr } = await supabase
        .from('branch_lists')
        .insert({ branch_id: branchId, name: displayName })
        .select('id, name')
        .single()
      if (legacyErr) {
        if (legacyErr.code === '23505') {
          return findListByNormalized(supabase, branchId, key)
        }
        console.error('[findOrCreateBranchList]', legacyErr.message)
        return null
      }
      return createdLegacy
    }
    if (error.code === '23505') {
      return findListByNormalized(supabase, branchId, key)
    }
    console.error('[findOrCreateBranchList]', error.message)
    return null
  }
  return created
}

/** نتيجة فحص تكرار عند الإضافة/التعديل */
export async function findConflictingBranchList(
  supabase: SupabaseClient,
  branchId: string,
  rawName: string,
  excludeId?: string,
): Promise<{ id: string; name: string; normalized_name: string } | null> {
  const key = normalizeBranchListName(rawName)
  if (!key) return null
  const hit = await findListByNormalized(supabase, branchId, key, excludeId)
  if (!hit) return null
  return { ...hit, normalized_name: key }
}

export { normalizeBranchListName, preferBranchListDisplayName, sanitizeBranchListDisplayName }

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
