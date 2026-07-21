/**
 * Case / section scope — مصدر مركزي لعزل المدني عن الجزائي.
 * لا تستورد من permissions لتفادي الاعتماد الدائري.
 */
import {
  CASE_TYPE_CIVIL,
  CASE_TYPE_CRIMINAL,
  type CaseType,
  isCaseType,
  normalizeCaseType,
} from '@/lib/case-type'

/** نطاق رؤية المستخدم للقسم */
export type CaseSection = CaseType | 'both'

export type CaseScope = {
  /** القسم الفعّال: civil | criminal | both */
  section: CaseSection
  /** إن وُجدت قيمة → يجب تطبيق .eq('case_type', …) على الاستعلام */
  filterCaseType: CaseType | null
  role: string | null
}

/** يحل نطاق القسم من الدور (وللمحامي من case_type الخاص به) */
export function resolveCaseScope(
  role: string | null | undefined,
  opts?: { lawyerCaseType?: string | null },
): CaseScope {
  const r = role ?? null

  if (r === 'viewer') {
    return { section: CASE_TYPE_CIVIL, filterCaseType: CASE_TYPE_CIVIL, role: r }
  }
  if (r === 'criminal_legal_manager') {
    return { section: CASE_TYPE_CRIMINAL, filterCaseType: CASE_TYPE_CRIMINAL, role: r }
  }
  if (r === 'lawyer') {
    const ct = normalizeCaseType(opts?.lawyerCaseType)
    return { section: ct, filterCaseType: ct, role: r }
  }
  // مندوب: مسار ميداني مرتبط بالمهام المدنية حاليًا
  if (r === 'delegate') {
    return { section: CASE_TYPE_CIVIL, filterCaseType: CASE_TYPE_CIVIL, role: r }
  }
  // admin / accountant / employee / payment_follow_up → الاثنان
  if (
    r === 'admin'
    || r === 'accountant'
    || r === 'employee'
    || r === 'payment_follow_up'
  ) {
    return { section: 'both', filterCaseType: null, role: r }
  }

  // افتراضي آمن: مدني فقط
  return { section: CASE_TYPE_CIVIL, filterCaseType: CASE_TYPE_CIVIL, role: r }
}

/** هل النطاق يسمح بالقسم المطلوب؟ */
export function assertSectionAccess(
  scope: CaseScope | CaseSection,
  required: CaseType,
): boolean {
  const section = typeof scope === 'string' ? scope : scope.section
  if (section === 'both') return true
  return section === required
}

export function assertDebtorSection(
  scope: CaseScope | CaseSection,
  debtorCaseType: string | null | undefined,
): boolean {
  return assertSectionAccess(scope, normalizeCaseType(debtorCaseType))
}

export function assertLawyerSection(
  scope: CaseScope | CaseSection,
  lawyerCaseType: string | null | undefined,
): boolean {
  return assertSectionAccess(scope, normalizeCaseType(lawyerCaseType))
}

/**
 * قيمة الفلتر للاستعلام:
 * - CaseType → .eq('case_type', value)
 * - null → بدون فلتر (both)
 */
export function filterBySection(scope: CaseScope | CaseSection): CaseType | null {
  if (typeof scope === 'string') {
    return scope === 'both' ? null : scope
  }
  return scope.filterCaseType
}

/** هل المدين الجزائي يجب أن يكون بلا قائمة فرع؟ */
export function requiresNullBranchList(caseType: string | null | undefined): boolean {
  return normalizeCaseType(caseType) === CASE_TYPE_CRIMINAL
}

/** يفرض null للقائمة عند الجزائي؛ وإلا يعيد القيمة كما هي */
export function normalizeBranchListForCaseType(
  caseType: string | null | undefined,
  branchListId: string | null | undefined,
): string | null {
  if (requiresNullBranchList(caseType)) return null
  const v = typeof branchListId === 'string' ? branchListId.trim() : ''
  return v || null
}

/** رفض صريح إن أُرسلت قائمة مع مدين جزائي */
export function rejectBranchListForCriminal(
  caseType: string | null | undefined,
  branchListId: string | null | undefined,
): string | null {
  if (!requiresNullBranchList(caseType)) return null
  const v = typeof branchListId === 'string' ? branchListId.trim() : ''
  if (v) return 'المدين الجزائي لا يستخدم قائمة الفرع'
  return null
}

export function sectionForbiddenMessage(): string {
  return 'لا صلاحية على هذا القسم (مدني/جزائي)'
}

export function sectionForbiddenResponse(): Response {
  return Response.json({ error: sectionForbiddenMessage() }, { status: 403 })
}

export function parseCaseTypeInput(value: unknown): CaseType | null {
  if (isCaseType(value)) return value
  return null
}

export { CASE_TYPE_CIVIL, CASE_TYPE_CRIMINAL, normalizeCaseType, isCaseType }
export type { CaseType }
