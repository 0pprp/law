import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, canAssignTasks, isAdmin, isAnyLegalManager } from '@/lib/permissions'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'
import {
  ensureLegalArchiveStatusId,
  resolveExperimentalBranchId,
} from '@/lib/experimental-queues'

const MAX_IDS = 500

function canUse(role: string | null | undefined): boolean {
  return isAdmin(role) || isAnyLegalManager(role) || canAssignTasks(role)
}

function parseIds(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { debtorIds?: unknown }).debtorIds
  if (!Array.isArray(raw)) return null
  const ids = [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))]
  return ids.length ? ids.slice(0, MAX_IDS) : null
}

/** نقل أسماء من «المضافة مؤخراً» إلى أرشيف القانونية */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canUse(auth.profile?.role)) return apiForbiddenResponse()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const debtorIds = parseIds(body)
  if (!debtorIds) return safeClientError('معرّفات المدينين مطلوبة', 400)

  const admin = createAdminClient()
  const branchId = await resolveExperimentalBranchId(admin)
  if (!branchId) return safeClientError('فرع تجريبي غير موجود', 404)

  try {
    const archiveStatusId = await ensureLegalArchiveStatusId(admin, branchId)

    const { data: targets, error } = await admin
      .from('debtors')
      .select('id, full_name, branch_id, current_task_id, special_status_id, special_status_return_task_id')
      .in('id', debtorIds)
      .eq('branch_id', branchId)
    if (error) return apiServerError('move-to-archive:targets', error)
    if (!targets?.length) return safeClientError('لم يُعثر على الأسماء في الفرع التجريبي', 404)

    let updated = 0
    for (const d of targets) {
      const patch: Record<string, unknown> = { special_status_id: archiveStatusId }
      if (d.current_task_id && !d.special_status_return_task_id) {
        patch.special_status_return_task_id = d.current_task_id
      }
      const { error: updErr } = await admin.from('debtors').update(patch).eq('id', d.id)
      if (updErr) return apiServerError('move-to-archive:update', updErr)
      updated += 1
    }

    await logActivity({
      action: 'set_debtor_special_status',
      entity_type: 'debtor',
      description: `نقل ${updated} اسم إلى أرشيف القانونية (تجريبي)`,
      metadata: { debtorIds: targets.map(t => t.id), archiveStatusId },
    }, auth.supabase)

    return NextResponse.json({ ok: true, updated })
  } catch (e) {
    return apiServerError('move-to-archive', e)
  }
}
