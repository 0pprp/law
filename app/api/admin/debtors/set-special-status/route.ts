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

function isMissingReturnTaskColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false
  const msg = error.message ?? ''
  return (
    msg.includes('special_status_return_task_id')
    || error.code === '42703'
    || error.code === 'PGRST204'
  )
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

  let supportReturnTask = true
  let targets: Array<{
    id: string
    branch_id: string | null
    case_type: string | null
    current_task_id: string | null
    special_status_id: string | null
    special_status_return_task_id?: string | null
  }> = []

  {
    const full = await admin
      .from('debtors')
      .select('id, branch_id, case_type, current_task_id, special_status_id, special_status_return_task_id')
      .in('id', debtorIds)
    if (full.error && isMissingReturnTaskColumn(full.error)) {
      supportReturnTask = false
      const basic = await admin
        .from('debtors')
        .select('id, branch_id, case_type, current_task_id, special_status_id')
        .in('id', debtorIds)
      if (basic.error) return apiServerError('set-special-status:targets', basic.error)
      targets = (basic.data ?? []) as typeof targets
    } else if (full.error) {
      return apiServerError('set-special-status:targets', full.error)
    } else {
      targets = (full.data ?? []) as typeof targets
    }
  }

  if (section && targets.some(d => (d.case_type ?? 'civil') !== section)) {
    return safeClientError('بعض المدينين خارج نطاق قسمك', 403)
  }

  let statusLabel = 'بدون صفة'
  let restored = 0

  if (!statusId) {
    // إرجاع للمهام: استعادة المهمة المحفوظة وإزالة الصفة
    for (const d of targets) {
      const patch: Record<string, unknown> = { special_status_id: null }
      const returnTaskId = d.special_status_return_task_id ?? d.current_task_id ?? null
      if (supportReturnTask) {
        if (returnTaskId) {
          const { data: task } = await admin
            .from('tasks')
            .select('id')
            .eq('id', returnTaskId)
            .eq('debtor_id', d.id)
            .maybeSingle()
          if (task?.id) {
            patch.current_task_id = task.id
            restored += 1
          }
        }
        patch.special_status_return_task_id = null
      }

      const { error } = await admin.from('debtors').update(patch).eq('id', d.id)
      if (error && supportReturnTask && isMissingReturnTaskColumn(error)) {
        supportReturnTask = false
        const { error: fallbackErr } = await admin
          .from('debtors')
          .update({ special_status_id: null })
          .eq('id', d.id)
        if (fallbackErr) return apiServerError('set-special-status:clear', fallbackErr)
      } else if (error) {
        return apiServerError('set-special-status:clear', error)
      }
    }
  } else {
    const { data: status, error: statusErr } = await admin
      .from('special_statuses')
      .select('id, name, branch_id, is_active')
      .eq('id', statusId)
      .maybeSingle()
    if (statusErr) return apiServerError('set-special-status:status', statusErr)
    if (!status?.is_active) return safeClientError('الصفة غير موجودة أو غير نشطة', 404)
    statusLabel = status.name

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

    const orphans: string[] = []
    for (const d of targets) {
      const resolved = d.branch_id ? byBranch.get(d.branch_id) : null
      if (!resolved) {
        orphans.push(d.id)
        continue
      }

      const patch: Record<string, unknown> = { special_status_id: resolved }
      if (supportReturnTask && d.current_task_id) {
        // دخول جديد أو بلا لقطة سابقة: احفظ المهمة الحالية للرجوع
        if (!d.special_status_id || !d.special_status_return_task_id) {
          patch.special_status_return_task_id = d.current_task_id
        }
      }

      const { error } = await admin.from('debtors').update(patch).eq('id', d.id)
      if (error && supportReturnTask && isMissingReturnTaskColumn(error)) {
        supportReturnTask = false
        const { error: fallbackErr } = await admin
          .from('debtors')
          .update({ special_status_id: resolved })
          .eq('id', d.id)
        if (fallbackErr) return apiServerError('set-special-status:update', fallbackErr)
      } else if (error) {
        return apiServerError('set-special-status:update', error)
      }
    }

    if (orphans.length) {
      return safeClientError(`الصفة «${status.name}» غير متوفرة لفرع ${orphans.length} من المدينين المحددين`, 400)
    }
  }

  await logActivity({
    action: 'set_debtor_special_status',
    entity_type: 'debtor',
    description: statusId
      ? `تعيين صفة «${statusLabel}» لـ ${debtorIds.length} مدين (مع حفظ المهمة المرتبطة)`
      : `إرجاع ${debtorIds.length} مدين للمهام${restored ? ` (استعادة ${restored} مهمة)` : ''}`,
    metadata: {
      debtorIds,
      statusId,
      count: debtorIds.length,
      restored,
      savedReturnTask: supportReturnTask,
    },
  }, auth.supabase)

  return NextResponse.json({
    ok: true,
    updated: debtorIds.length,
    statusId,
    restored,
    savedReturnTask: supportReturnTask,
  })
}
