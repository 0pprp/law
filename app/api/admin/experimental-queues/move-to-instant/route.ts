import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, canAssignTasks, canViewInstantCases, isAdmin, isAnyLegalManager } from '@/lib/permissions'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'
import { LEGAL_ARCHIVE_STATUS_NAME } from '@/lib/experimental-queues'

const MAX_IDS = 200

function canUse(role: string | null | undefined): boolean {
  return (isAdmin(role) || isAnyLegalManager(role) || canAssignTasks(role)) && canViewInstantCases(role)
}

function parseIds(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { debtorIds?: unknown }).debtorIds
  if (!Array.isArray(raw)) return null
  const ids = [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))]
  return ids.length ? ids.slice(0, MAX_IDS) : null
}

/**
 * من الأسماء المضافة مؤخراً → الدعاوى الفورية:
 * إنشاء ترشيح معتمد مربوط بالمدين الحالي.
 */
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
  const userId = auth.user!.id

  try {
    const { data: targets, error } = await admin
      .from('debtors')
      .select('id, full_name, branch_id, branch_list_id, required_amount, governorate, case_type, special_status_id, special_status:special_statuses(id, name)')
      .in('id', debtorIds)
    if (error) return apiServerError('move-to-instant:targets', error)
    if (!targets?.length) return safeClientError('لا توجد أسماء مطابقة', 404)

    const denied = targets.find(d => d.branch_id && !canStaffWriteBranch(auth.profile, d.branch_id))
    if (denied) return apiForbiddenResponse()

    const failed: { id: string; name: string; reason: string }[] = []
    let created = 0

    for (const d of targets) {
      const ss = Array.isArray(d.special_status) ? d.special_status[0] : d.special_status
      if (d.special_status_id || ss?.name === LEGAL_ARCHIVE_STATUS_NAME) {
        failed.push({ id: d.id, name: d.full_name, reason: 'حوّل من الأسماء المضافة مؤخراً — الاسم في الأرشيف أو صفة خاصة' })
        continue
      }
      if (d.case_type === 'criminal') {
        failed.push({ id: d.id, name: d.full_name, reason: 'الدعاوى الفورية للدعاوى المدنية فقط' })
        continue
      }
      if (!d.branch_id) {
        failed.push({ id: d.id, name: d.full_name, reason: 'لا يوجد فرع للمدين' })
        continue
      }
      if (!d.branch_list_id) {
        failed.push({ id: d.id, name: d.full_name, reason: 'لا توجد قائمة فرع للمدين' })
        continue
      }

      const sale = Number(d.required_amount) > 0 ? Number(d.required_amount) : 1

      const { data: existing } = await admin
        .from('instant_case_nominations')
        .select('id')
        .eq('debtor_id', d.id)
        .in('status', ['pending', 'approved'])
        .limit(1)

      if (!existing?.length) {
        const { error: insErr } = await admin.from('instant_case_nominations').insert({
          branch_id: d.branch_id,
          branch_list_id: d.branch_list_id,
          debtor_name: d.full_name,
          sale_price: sale,
          governorate: d.governorate ?? null,
          nominated_by: userId,
          nominator_role: 'accountant',
          status: 'approved',
          debtor_id: d.id,
          reviewed_by: userId,
          reviewed_at: new Date().toISOString(),
        })
        if (insErr) {
          failed.push({ id: d.id, name: d.full_name, reason: insErr.message })
          continue
        }
      }

      created += 1
    }

    await logActivity({
      action: 'set_debtor_special_status',
      entity_type: 'debtor',
      description: `تحويل ${created} اسم من الأسماء المضافة مؤخراً إلى الدعاوى الفورية`,
      metadata: { created, failed: failed.length },
    }, auth.supabase)

    return NextResponse.json({ ok: true, moved: created, failed })
  } catch (e) {
    return apiServerError('move-to-instant', e)
  }
}
