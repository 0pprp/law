'use client'

import { useAdminRole } from '@/context/admin-role'
import { filterBySection, resolveCaseScope, type CaseScope, type CaseType } from '@/lib/case-scope'

/** نطاق القسم للواجهة — مصدر واحد للفلاتر والعدادات */
export function useCaseScope(): CaseScope & { caseTypeFilter: CaseType | null } {
  const role = useAdminRole()
  const scope = resolveCaseScope(role)
  return { ...scope, caseTypeFilter: filterBySection(scope) }
}
