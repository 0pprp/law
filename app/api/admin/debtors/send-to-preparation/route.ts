import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, canSendToFilePreparation } from '@/lib/permissions'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'

const MAX_IDS = 500

type FailRow = { id: string; name: string; reason: string }

function parseDebtorIds(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { debtorIds?: unknown }).debtorIds
  if (!Array.isArray(raw)) return null
  const ids = [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))]
  return ids.length ? ids.slice(0, MAX_IDS) : null
}

/**
 * إرسال مدينين لتجهيز الملفات لدى المحاسب الرئيسي المسؤول عن فرع كل مدين.
 * المدير فقط.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canSendToFilePreparation(auth.profile?.role)) return apiForbiddenResponse()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const debtorIds = parseDebtorIds(body)
  if (!debtorIds) return safeClientError('معرّفات المدينين مطلوبة', 400)

  const admin = createAdminClient()

  const { data: targets, error: targetsErr } = await admin
    .from('debtors')
    .select('id, full_name, branch_id, file_preparation_status')
    .in('id', debtorIds)

  if (targetsErr) {
    if (String(targetsErr.message ?? '').includes('file_preparation_status')) {
      return safeClientError('عمود تجهيز الملفات غير مفعّل بعد في قاعدة البيانات — طبّق الهجرة أولاً', 400)
    }
    return apiServerError('send-to-preparation:targets', targetsErr)
  }

  if (!targets?.length) return safeClientError('لم يُعثر على المدينين المحددين', 404)

  const branchIds = [...new Set(
    targets.map(t => t.branch_id).filter((id): id is string => Boolean(id)),
  )]

  const { data: branchRows } = branchIds.length
    ? await admin.from('branches').select('id, name').in('id', branchIds)
    : { data: [] as { id: string; name: string }[] }
  const branchNameById = new Map((branchRows ?? []).map(b => [b.id, b.name]))

  const caByBranch = new Map<string, string[]>()
  if (branchIds.length) {
    const { data: links, error: linksErr } = await admin
      .from('chief_accountant_branches')
      .select('branch_id, profile_id')
      .in('branch_id', branchIds)

    if (linksErr) {
      if (String(linksErr.message ?? '').includes('chief_accountant_branches')) {
        return safeClientError('جدول فروع المحاسب الرئيسي غير مفعّل بعد — طبّق الهجرة أولاً', 400)
      }
      return apiServerError('send-to-preparation:links', linksErr)
    }

    const profileIds = [...new Set((links ?? []).map(l => l.profile_id).filter(Boolean))]
    const activeChiefIds = new Set<string>()
    if (profileIds.length) {
      const { data: profiles, error: profErr } = await admin
        .from('profiles')
        .select('id, role, is_active')
        .in('id', profileIds)
        .eq('role', 'chief_accountant')
      if (profErr) return apiServerError('send-to-preparation:profiles', profErr)
      for (const p of profiles ?? []) {
        if (p.is_active === false) continue
        activeChiefIds.add(p.id)
      }
    }

    for (const row of links ?? []) {
      if (!activeChiefIds.has(row.profile_id)) continue
      const list = caByBranch.get(row.branch_id) ?? []
      list.push(row.profile_id)
      caByBranch.set(row.branch_id, list)
    }
  }

  const failed: FailRow[] = []
  const byChief = new Map<string, string[]>()

  for (const d of targets) {
    const name = d.full_name?.trim() || d.id
    if (!d.branch_id) {
      failed.push({ id: d.id, name, reason: 'المدين بلا فرع' })
      continue
    }
    if (d.file_preparation_status === 'preparing') {
      failed.push({ id: d.id, name, reason: 'قيد التجهيز مسبقاً' })
      continue
    }
    const chiefs = caByBranch.get(d.branch_id) ?? []
    const branchLabel = branchNameById.get(d.branch_id) ?? 'غير معروف'
    if (chiefs.length === 0) {
      failed.push({
        id: d.id,
        name,
        reason: `لا يوجد محاسب رئيسي مسؤول عن فرع «${branchLabel}»`,
      })
      continue
    }
    if (chiefs.length > 1) {
      failed.push({
        id: d.id,
        name,
        reason: `يوجد أكثر من محاسب رئيسي لفرع «${branchLabel}» — راجع التعيينات`,
      })
      continue
    }
    const chiefId = chiefs[0]!
    const prev = byChief.get(chiefId) ?? []
    prev.push(d.id)
    byChief.set(chiefId, prev)
  }

  const updatedIds: string[] = []
  for (const [chiefId, ids] of byChief) {
    const { error } = await admin
      .from('debtors')
      .update({
        file_preparation_status: 'preparing',
        assigned_chief_accountant_id: chiefId,
      })
      .in('id', ids)
    if (error) {
      if (String(error.message ?? '').includes('file_preparation_status')
        || String(error.message ?? '').includes('assigned_chief_accountant')) {
        return safeClientError('أعمدة تجهيز الملفات غير مفعّلة بعد في قاعدة البيانات — طبّق الهجرة أولاً', 400)
      }
      return apiServerError('send-to-preparation:update', error)
    }
    updatedIds.push(...ids)
  }

  if (updatedIds.length) {
    await logActivity({
      action: 'send_debtors_to_preparation',
      entity_type: 'debtor',
      description: `إرسال ${updatedIds.length} مدين لتجهيز الملفات`,
      metadata: {
        debtorIds: updatedIds,
        failedCount: failed.length,
      },
    }, auth.supabase)
  }

  if (updatedIds.length === 0) {
    const sample = failed[0]?.reason ?? 'تعذر الإرسال'
    return NextResponse.json(
      {
        ok: false,
        error: sample,
        updated: 0,
        failed,
      },
      { status: 400 },
    )
  }

  return NextResponse.json({
    ok: true,
    updated: updatedIds.length,
    updatedIds,
    failed,
  })
}
