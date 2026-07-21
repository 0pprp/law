/**
 * حراسة موارد بالـ id — تستخدم resolveCaseScope / assertDebtorSection / assertLawyerSection فقط.
 * لا تكرر منطق القسم.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assertDebtorSection,
  assertLawyerSection,
  filterBySection,
  sectionForbiddenResponse,
  type CaseScope,
  type CaseType,
} from '@/lib/case-scope'

export type SectionGuardOk<T> = { ok: true; data: T; caseType: CaseType }
export type SectionGuardFail = { ok: false; error: Response }
export type SectionGuardResult<T> = SectionGuardOk<T> | SectionGuardFail

function asCaseType(v: unknown): CaseType {
  return v === 'criminal' ? 'criminal' : 'civil'
}

/** يطبّق .eq('case_type', …) على استعلام مدينين إن وُجد فلتر نطاق */
export function applyDebtorSectionFilter<Q extends { eq: (c: string, v: string) => Q }>(
  query: Q,
  scope: CaseScope,
): Q {
  const ct = filterBySection(scope)
  return ct ? query.eq('case_type', ct) : query
}

/** يحمّل مدينًا ويتحقق من القسم — 403 إن خارج النطاق */
export async function requireDebtorInScope(
  supabase: SupabaseClient,
  scope: CaseScope,
  debtorId: string,
  select = 'id, branch_id, case_type',
): Promise<SectionGuardResult<Record<string, unknown>>> {
  if (!debtorId) {
    return { ok: false, error: Response.json({ error: 'معرّف المدين مطلوب' }, { status: 400 }) }
  }
  const { data, error } = await supabase
    .from('debtors')
    .select(select)
    .eq('id', debtorId)
    .maybeSingle()
  if (error) {
    return { ok: false, error: Response.json({ error: error.message }, { status: 500 }) }
  }
  if (!data) {
    return { ok: false, error: Response.json({ error: 'المدين غير موجود' }, { status: 404 }) }
  }
  const caseType = asCaseType((data as { case_type?: string }).case_type)
  if (!assertDebtorSection(scope, caseType)) {
    return { ok: false, error: sectionForbiddenResponse() }
  }
  return { ok: true, data: data as unknown as Record<string, unknown>, caseType }
}

/**
 * يحمّل مهمة مع مدينها ويتحقق من قسم المدين.
 * tasks لا تحمل case_type — المصدر هو debtors.
 */
export async function requireTaskInScope(
  supabase: SupabaseClient,
  scope: CaseScope,
  taskId: string,
): Promise<SectionGuardResult<{
  task: Record<string, unknown>
  debtor_id: string | null
  caseType: CaseType
}>> {
  if (!taskId) {
    return { ok: false, error: Response.json({ error: 'معرّف المهمة مطلوب' }, { status: 400 }) }
  }
  const { data: task, error } = await supabase
    .from('tasks')
    .select('id, debtor_id, branch_id, assigned_to, task_status, task_definition_id')
    .eq('id', taskId)
    .maybeSingle()
  if (error) {
    return { ok: false, error: Response.json({ error: error.message }, { status: 500 }) }
  }
  if (!task) {
    return { ok: false, error: Response.json({ error: 'المهمة غير موجودة' }, { status: 404 }) }
  }

  const debtorId = (task as { debtor_id?: string | null }).debtor_id ?? null
  if (!debtorId) {
    // مهمة بلا مدين — امنع إن كان النطاق مقيّدًا (لا نعرف القسم)
    if (filterBySection(scope)) {
      return { ok: false, error: sectionForbiddenResponse() }
    }
    return {
      ok: true,
      data: { task: task as unknown as Record<string, unknown>, debtor_id: null, caseType: 'civil' },
      caseType: 'civil',
    }
  }

  const debtorGate = await requireDebtorInScope(supabase, scope, debtorId, 'id, case_type, branch_id')
  if (!debtorGate.ok) return debtorGate

  return {
    ok: true,
    data: {
      task: task as unknown as Record<string, unknown>,
      debtor_id: debtorId,
      caseType: debtorGate.caseType,
    },
    caseType: debtorGate.caseType,
  }
}

/** يحمّل محاميًا (profile role=lawyer) ويتحقق من قسمه */
export async function requireLawyerInScope(
  supabase: SupabaseClient,
  scope: CaseScope,
  lawyerId: string,
  select = 'id, role, case_type, branch_id, full_name, is_active',
): Promise<SectionGuardResult<Record<string, unknown>>> {
  if (!lawyerId) {
    return { ok: false, error: Response.json({ error: 'معرّف المحامي مطلوب' }, { status: 400 }) }
  }
  const { data, error } = await supabase
    .from('profiles')
    .select(select)
    .eq('id', lawyerId)
    .maybeSingle()
  if (error) {
    return { ok: false, error: Response.json({ error: error.message }, { status: 500 }) }
  }
  if (!data) {
    return { ok: false, error: Response.json({ error: 'المستخدم غير موجود' }, { status: 404 }) }
  }
  const role = (data as { role?: string }).role
  if (role === 'lawyer') {
    const caseType = asCaseType((data as { case_type?: string }).case_type)
    if (!assertLawyerSection(scope, caseType)) {
      return { ok: false, error: sectionForbiddenResponse() }
    }
    return { ok: true, data: data as unknown as Record<string, unknown>, caseType }
  }
  // أدوار أخرى: لا فلتر قسم محامي
  return { ok: true, data: data as unknown as Record<string, unknown>, caseType: asCaseType((data as { case_type?: string }).case_type) }
}

/** فلتر قائمة محامين حسب النطاق */
export function applyLawyerSectionFilter<Q extends { eq: (c: string, v: string) => Q }>(
  query: Q,
  scope: CaseScope,
): Q {
  const ct = filterBySection(scope)
  return ct ? query.eq('case_type', ct) : query
}
