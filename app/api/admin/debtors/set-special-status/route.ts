import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canManageSpecialStatuses } from '@/lib/permissions'
import { filterBySection } from '@/lib/case-scope'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'

const MAX_IDS = 500

function parseDebtorIds(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { debtorIds?: unknown }).debtorIds
  if (!Array.isArray(raw)) return null
  const ids = [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))]
  return ids.length ? ids.slice(0, MAX_IDS) : null
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canManageSpecialStatuses(auth.profile?.role)) return apiForbiddenResponse()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const debtorIds = parseDebtorIds(body)
  if (!debtorIds) return safeClientError('معرّفات المدينين مطلوبة', 400)

  const statusIdRaw = (body as { statusId?: unknown }).statusId
  const statusId = statusIdRaw == null || statusIdRaw === ''
    ? null
    : String(statusIdRaw).trim() || null

  const admin = createAdminClient()
  const section = filterBySection(sessionCaseScope(auth.profile))

  const { data: targets, error: targetsErr } = await admin
    .from('debtors')
    .select('id, branch_id, case_type')
    .in('id', debtorIds)
  if (targetsErr) return apiServerError('set-special-status:targets', targetsErr)

  // نطاق الدور يعزل القسم — لا تسمح بتعديل مدينين خارج قسم المسؤول
  if (section && (targets ?? []).some(d => (d.case_type ?? 'civil') !== section)) {
    return safeClientError('بعض المدينين خارج نطاق قسمك', 403)
  }

  let statusLabel = 'بدون صفة'

  if (!statusId) {
    const { error } = await admin
      .from('debtors')
      .update({ special_status_id: null })
      .in('id', debtorIds)
    if (error) return apiServerError('set-special-status:update', error)
  } else {
    const { data: status, error: statusErr } = await admin
      .from('special_statuses')
      .select('id, name, branch_id, is_active')
      .eq('id', statusId)
      .maybeSingle()
    if (statusErr) return apiServerError('set-special-status:status', statusErr)
    if (!status?.is_active) return safeClientError('الصفة غير موجودة أو غير نشطة', 404)
    statusLabel = status.name

    // الصفة الواحدة لها نسخة بكل فرع — اربط كل مدين بنسخة فرعه
    const { data: siblings, error: sibErr } = await admin
      .from('special_statuses')
      .select('id, branch_id, is_active')
      .eq('name', status.name)
    if (sibErr) return apiServerError('set-special-status:siblings', sibErr)

    const byBranch = new Map<string, string>()
    for (const s of siblings ?? []) {
      if (s.is_active === false || !s.branch_id) continue
      byBranch.set(s.branch_id, s.id)
    }

    const idsByStatus = new Map<string, string[]>()
    const orphans: string[] = []
    for (const d of targets ?? []) {
      const resolved = d.branch_id ? byBranch.get(d.branch_id) : null
      if (!resolved) {
        orphans.push(d.id)
        continue
      }
      const prev = idsByStatus.get(resolved) ?? []
      prev.push(d.id)
      idsByStatus.set(resolved, prev)
    }

    if (orphans.length) {
      return safeClientError(`الصفة «${status.name}» غير متوفرة لفرع ${orphans.length} من المدينين المحددين`, 400)
    }

    for (const [sid, ids] of idsByStatus) {
      const { error } = await admin
        .from('debtors')
        .update({ special_status_id: sid })
        .in('id', ids)
      if (error) return apiServerError('set-special-status:update', error)
    }
  }

  await logActivity({
    action: 'set_debtor_special_status',
    entity_type: 'debtor',
    description: statusId
      ? `تعيين صفة «${statusLabel}» لـ ${debtorIds.length} مدين`
      : `إزالة الصفة الخاصة عن ${debtorIds.length} مدين`,
    metadata: { debtorIds, statusId, count: debtorIds.length },
  }, auth.supabase)

  return NextResponse.json({ ok: true, updated: debtorIds.length, statusId })
}
