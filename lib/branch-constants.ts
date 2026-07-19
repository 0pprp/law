/** Legacy branch name — must not appear in UI or accept new data. */
export const MAIN_BRANCH_NAME = 'الفرع الرئيسي'

/** Legacy short names — must never appear in branch picker (use official names). */
export const LEGACY_BRANCH_ALIASES = ['الكرخ', 'الرصافة'] as const

/** Official operational branches (display order). */
export const APPROVED_BRANCH_NAMES = [
  'بغداد الكرخ',
  'بغداد الرصافة',
  'بابل',
  'البصرة',
  'الديوانية',
  'ديالى',
  'كربلاء',
  'كركوك',
  'الموصل',
  'النجف الأشرف',
  'الناصرية',
  'السماوة',
] as const

export type ApprovedBranchName = (typeof APPROVED_BRANCH_NAMES)[number]

export function isMainBranchName(name: string | null | undefined): boolean {
  if (!name) return false
  return name.trim() === MAIN_BRANCH_NAME
}

export function isLegacyBranchAlias(name: string | null | undefined): boolean {
  if (!name) return false
  return (LEGACY_BRANCH_ALIASES as readonly string[]).includes(name.trim())
}

export function isApprovedBranchName(name: string | null | undefined): boolean {
  if (!name) return false
  return (APPROVED_BRANCH_NAMES as readonly string[]).includes(name.trim())
}

export function filterSelectableBranches<T extends { name: string }>(branches: T[]): T[] {
  const approved = new Set(APPROVED_BRANCH_NAMES as readonly string[])
  return branches
    .filter(b => approved.has(b.name.trim()) && !isLegacyBranchAlias(b.name))
    .sort(
      (a, b) =>
        (APPROVED_BRANCH_NAMES as readonly string[]).indexOf(a.name.trim()) -
        (APPROVED_BRANCH_NAMES as readonly string[]).indexOf(b.name.trim()),
    )
}

export function pickDefaultBranch<T extends { id: string; name: string }>(branches: T[]): T | null {
  const selectable = filterSelectableBranches(branches)
  if (!selectable.length) return null
  const karkh = selectable.find(b => b.name === 'بغداد الكرخ')
  return karkh ?? selectable[0]
}
