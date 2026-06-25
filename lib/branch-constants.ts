/** Legacy branch name — must not appear in UI or accept new data. */
export const MAIN_BRANCH_NAME = 'الفرع الرئيسي'

/** Official operational branches (display order). */
export const APPROVED_BRANCH_NAMES = [
  'بغداد الكرخ',
  'بغداد الرصافة',
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

export function isApprovedBranchName(name: string | null | undefined): boolean {
  if (!name) return false
  return (APPROVED_BRANCH_NAMES as readonly string[]).includes(name.trim())
}

export function filterSelectableBranches<T extends { name: string }>(branches: T[]): T[] {
  return branches.filter(b => !isMainBranchName(b.name))
}

export function pickDefaultBranch<T extends { id: string; name: string }>(branches: T[]): T | null {
  const selectable = filterSelectableBranches(branches)
  if (!selectable.length) return null
  const karkh = selectable.find(b => b.name === 'بغداد الكرخ')
  return karkh ?? selectable[0]
}
