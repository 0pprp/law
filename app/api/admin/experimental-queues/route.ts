import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, canAssignTasks, isAdmin, isAnyLegalManager } from '@/lib/permissions'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import {
  countExperimentalQueue,
  ensureLegalArchiveStatusId,
  listExperimentalQueue,
  resolveExperimentalBranchId,
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

  const admin = createAdminClient()
  const branchId = await resolveExperimentalBranchId(admin)
  if (!branchId) return safeClientError('فرع تجريبي غير موجود', 404)

  try {
    const archiveStatusId = await ensureLegalArchiveStatusId(admin, branchId)
    if (countOnly) {
      const total = await countExperimentalQueue(admin, queue, branchId, archiveStatusId)
      return NextResponse.json({ total, branchId, archiveStatusId })
    }
    const [rows, total] = await Promise.all([
      listExperimentalQueue(admin, queue, branchId, archiveStatusId, { q, limit, offset }),
      countExperimentalQueue(admin, queue, branchId, archiveStatusId),
    ])
    return NextResponse.json({ rows, total, branchId, archiveStatusId })
  } catch (e) {
    return apiServerError('experimental-queues:get', e)
  }
}
