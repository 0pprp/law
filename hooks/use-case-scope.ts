'use client'

import { useAdminRoleState } from '@/context/admin-role'
import { filterBySection, resolveCaseScope, type CaseScope, type CaseType } from '@/lib/case-scope'

/** نطاق القسم للواجهة — مصدر واحد للفلاتر والعدادات */
export function useCaseScope(): CaseScope & { caseTypeFilter: CaseType | null } {
  const { role, canAccessCivil, canAccessCriminal } = useAdminRoleState()
  const scope = resolveCaseScope(role, {
    canAccessCivil,
    canAccessCriminal,
  })
  return { ...scope, caseTypeFilter: filterBySection(scope) }
}
