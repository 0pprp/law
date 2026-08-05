import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeCaseType } from '@/lib/case-type'

/** هل المهمة إقامة دعوى؟ */
export function isFileLawsuitTask(task: {
  task_type?: string | null
  task_definitions?: { label?: string | null } | { label?: string | null }[] | null
  label?: string | null
}): boolean {
  if (task.task_type === 'file_lawsuit') return true
  const def = Array.isArray(task.task_definitions)
    ? task.task_definitions[0]
    : task.task_definitions
  const label = def?.label ?? task.label ?? ''
  return label.includes('إقامة دعوى')
}

/** هل التعريف مرافعات؟ */
export function isPleadingDefinition(def: {
  task_type?: string | null
  label?: string | null
}): boolean {
  if (def.task_type === 'pleading') return true
  return (def.label ?? '').includes('مرافع')
}

/**
 * يجد تعريف «مرافعات» المناسب لنفس الفرع ونوع الدعوى.
 * يفضّل task_type=pleading ثم التسمية، ونفس branch_id.
 */
export function pickPleadingDefinition<T extends {
  id: string
  task_type?: string | null
  label?: string | null
  branch_id?: string | null
  case_type?: string | null
}>(
  defs: T[],
  opts: { branchId?: string | null; caseType?: string | null },
): T | null {
  const caseType = normalizeCaseType(opts.caseType)
  const branchId = opts.branchId ?? null

  const scoped = defs.filter(d => {
    if (normalizeCaseType(d.case_type) !== caseType) return false
    if (branchId && d.branch_id && d.branch_id !== branchId) return false
    return isPleadingDefinition(d)
  })

  if (!scoped.length) return null

  const sameBranch = branchId
    ? scoped.filter(d => d.branch_id === branchId)
    : scoped
  const pool = sameBranch.length ? sameBranch : scoped

  return (
    pool.find(d => d.task_type === 'pleading')
    ?? pool.find(d => (d.label ?? '').includes('مرافع'))
    ?? pool[0]
    ?? null
  )
}

/** من قاعدة البيانات: تعريف مرافعات المناسب لمهمة إقامة دعوى */
export async function resolvePleadingDefIdForLawsuit(
  supabase: SupabaseClient,
  task: {
    task_type?: string | null
    branch_id?: string | null
    debtor_id?: string | null
    task_definitions?: { label?: string | null } | { label?: string | null }[] | null
  },
): Promise<{ defId: string; label: string } | null> {
  if (!isFileLawsuitTask(task)) return null

  let caseType: string | null = null
  if (task.debtor_id) {
    const { data: debtor } = await supabase
      .from('debtors')
      .select('case_type')
      .eq('id', task.debtor_id)
      .maybeSingle()
    caseType = debtor?.case_type ?? null
  }

  let q = supabase
    .from('task_definitions')
    .select('id, label, task_type, branch_id, case_type')
    .eq('is_active', true)
    .order('sort_order')

  if (task.branch_id) q = q.eq('branch_id', task.branch_id)
  if (caseType === 'criminal' || caseType === 'civil') q = q.eq('case_type', caseType)

  const { data } = await q
  const picked = pickPleadingDefinition(data ?? [], {
    branchId: task.branch_id,
    caseType,
  })
  if (!picked) return null
  return { defId: picked.id, label: picked.label ?? 'مرافعات' }
}
