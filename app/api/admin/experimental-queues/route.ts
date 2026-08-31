import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { filterBySection } from '@/lib/case-scope'
import { apiForbiddenResponse, canAssignTasks, isAdmin, isAnyLegalManager } from '@/lib/permissions'
import { canStaffReadBranch } from '@/lib/staff-branch-access'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import {
  countExperimentalQueue,
  listExperimentalQueue,
  type ExperimentalQueue,
} from '@/lib/experimental-queues'

function canUse(role: string | null | undefined): boolean {
  return isAdmin(role) || isAnyLegalManager(role) || canAssignTasks(role)
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canUse(auth.profile?.role)) return apiForbiddenResponse()

  const sp = request.nextUrl.searchParams
  const queue = (sp.get('queue') === 'archive' ? 'archive' : 'recent') as ExperimentalQueue
  const countOnly = sp.get('countOnly') === '1'
  const q = sp.get('q')?.trim() || undefined
  const limit = Number(sp.get('limit') || 80)
  const offset = Number(sp.get('offset') || 0)
  const viewAll = sp.get('viewAll') === '1'
  const requestedBranch = sp.get('branchId')?.trim() || null
  const branchId = viewAll ? null : requestedBranch
  if (!viewAll && !branchId) return safeClientError('معرّف الفرع مطلوب', 400)
  if (branchId && !canStaffReadBranch(auth.profile, branchId)) {
    return NextResponse.json({ error: 'لا صلاحية على هذا الفرع' }, { status: 403 })
  }

  const rawCase = sp.get('caseType')
  const scopeCase = filterBySection(sessionCaseScope(auth.profile))
  const caseType =
    rawCase === 'civil' || rawCase === 'criminal'
      ? rawCase
      : scopeCase
  if (scopeCase && caseType && scopeCase !== caseType) {
    return NextResponse.json({ rows: [], total: 0, branchId })
  }

  const listId = sp.get('listId')?.trim() || null
  const admin = createAdminClient()
  const scope = {
    branchId,
    branchListId: caseType === 'criminal' ? null : listId,
    caseType,
  }

  try {
    if (countOnly) {
      const total = await countExperimentalQueue(admin, queue, scope)
      return NextResponse.json({ total, branchId })
    }
    const [rows, total] = await Promise.all([
      listExperimentalQueue(admin, queue, scope, { q, limit, offset }),
      countExperimentalQueue(admin, queue, scope),
    ])
    return NextResponse.json({ rows, total, branchId })
  } catch (e) {
    return apiServerError('experimental-queues:get', e)
  }
}
