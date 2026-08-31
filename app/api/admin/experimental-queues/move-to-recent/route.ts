import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, canAssignTasks, isAdmin, isAnyLegalManager } from '@/lib/permissions'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'
import { ensureLegalArchiveStatusId, LEGAL_ARCHIVE_STATUS_NAME } from '@/lib/experimental-queues'

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

/** إرجاع أسماء من أرشيف القانونية إلى الأسماء المضافة مؤخراً */
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

  try {
    const { data: targets, error } = await admin
      .from('debtors')
      .select('id, full_name, branch_id, special_status_id, special_status:special_statuses(id, name)')
      .in('id', debtorIds)
    if (error) return apiServerError('move-to-recent:targets', error)
    if (!targets?.length) return safeClientError('لم يُعثر على الأسماء', 404)

    const denied = targets.find(d => d.branch_id && !canStaffWriteBranch(auth.profile, d.branch_id))
    if (denied) return apiForbiddenResponse()

    const archiveIds = new Set<string>()
    const branchIds = [...new Set(targets.map(t => t.branch_id).filter(Boolean))] as string[]
    for (const bId of branchIds) {
      archiveIds.add(await ensureLegalArchiveStatusId(admin, bId))
    }

    const failed: { id: string; name: string; reason: string }[] = []
    let updated = 0

    for (const d of targets) {
      const ss = Array.isArray(d.special_status) ? d.special_status[0] : d.special_status
      const isArchive =
        (d.special_status_id && archiveIds.has(d.special_status_id))
        || ss?.name === LEGAL_ARCHIVE_STATUS_NAME
      if (!isArchive) {
        failed.push({ id: d.id, name: d.full_name, reason: 'الاسم ليس في أرشيف القانونية' })
        continue
      }

      const { error: updErr } = await admin
        .from('debtors')
        .update({ special_status_id: null, special_status_return_task_id: null })
        .eq('id', d.id)
      if (updErr) {
        failed.push({ id: d.id, name: d.full_name, reason: updErr.message })
        continue
      }
      updated += 1
    }

    await logActivity({
      action: 'set_debtor_special_status',
      entity_type: 'debtor',
      description: `إرجاع ${updated} اسم من أرشيف القانونية إلى الأسماء المضافة مؤخراً`,
      metadata: { debtorIds: targets.map(t => t.id), updated, failed: failed.length },
    }, auth.supabase)

    return NextResponse.json({ ok: true, updated, failed })
  } catch (e) {
    return apiServerError('move-to-recent', e)
  }
}
