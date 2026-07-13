import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMutationStaff } from '@/lib/api-auth'
import { canManageSettings, apiForbiddenResponse } from '@/lib/permissions'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import {
  normalizeBranchListName,
  preferBranchListDisplayName,
  sanitizeBranchListDisplayName,
} from '@/lib/branch-list-normalize'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'

/**
 * دمج قوائم مكررة داخل نفس الفرع إلى قائمة أساسية واحدة.
 * ينقل debtors.branch_list_id و profiles.branch_list_id (+ identity_number عند الحاجة).
 */
export async function POST(request: NextRequest) {
  const auth = await requireMutationStaff()
  if (auth.error) return auth.error
  if (!canManageSettings(auth.profile?.role)) return apiForbiddenResponse()

  let body: {
    canonicalId?: string
    duplicateIds?: string[]
    displayName?: string
  }
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const canonicalId = String(body.canonicalId ?? '').trim()
  const duplicateIds = [...new Set((body.duplicateIds ?? []).map(id => String(id).trim()).filter(Boolean))]
    .filter(id => id !== canonicalId)

  if (!canonicalId || !duplicateIds.length) {
    return safeClientError('معرّفات الدمج غير مكتملة', 400)
  }

  const admin = createAdminClient()
  const allIds = [canonicalId, ...duplicateIds]
  const { data: rows, error } = await admin
    .from('branch_lists')
    .select('id, name, branch_id, created_at')
    .in('id', allIds)

  if (error || !rows?.length) {
    return safeClientError('القوائم غير موجودة', 404)
  }

  const byId = new Map(rows.map(r => [r.id, r]))
  const canonical = byId.get(canonicalId)
  if (!canonical) return safeClientError('القائمة الأساسية غير موجودة', 404)

  for (const id of duplicateIds) {
    const row = byId.get(id)
    if (!row) return safeClientError('قائمة مكررة غير موجودة', 404)
    if (row.branch_id !== canonical.branch_id) {
      return safeClientError('لا يمكن دمج قوائم من فروع مختلفة', 400)
    }
  }

  if (!canStaffWriteBranch(auth.profile, canonical.branch_id)) {
    return apiForbiddenResponse()
  }

  const displayName = sanitizeBranchListDisplayName(
    body.displayName
    || preferBranchListDisplayName(rows.map(r => r.name)),
  )
  const key = normalizeBranchListName(displayName)

  // نقل الارتباطات ثم حذف المكررات ثم تحديث الاسم المعروض
  // (تحديث الاسم قبل الحذف يصطدم بـ unique(branch_id, name) إن وُجد مكرر بنفس الاسم المرتب)
  let debtorsMoved = 0
  let delegatesMoved = 0

  for (const dupId of duplicateIds) {
    const { data: debtorRows, error: dErr } = await admin
      .from('debtors')
      .update({ branch_list_id: canonicalId })
      .eq('branch_list_id', dupId)
      .select('id')
    if (dErr) return apiServerError('merge-branch-lists:debtors', dErr, 'فشل نقل المدينين')
    debtorsMoved += debtorRows?.length ?? 0

    const { data: profileRows, error: pErr } = await admin
      .from('profiles')
      .update({ branch_list_id: canonicalId })
      .eq('branch_list_id', dupId)
      .select('id')
    if (pErr && !String(pErr.message ?? '').includes('branch_list_id')) {
      return apiServerError('merge-branch-lists:profiles', pErr, 'فشل نقل المندوبين')
    }
    delegatesMoved += profileRows?.length ?? 0

    const { data: byIdentity, error: iErr } = await admin
      .from('profiles')
      .update({
        identity_number: canonicalId,
        branch_list_id: canonicalId,
        identity_type: 'delegate_list',
      })
      .eq('identity_type', 'delegate_list')
      .eq('identity_number', dupId)
      .select('id')
    if (iErr && !String(iErr.message ?? '').includes('branch_list_id')) {
      console.error('[merge-branch-lists:identity]', iErr.message)
    } else {
      delegatesMoved += byIdentity?.length ?? 0
    }
  }

  for (const dupId of duplicateIds) {
    const { count: leftDebtors } = await admin
      .from('debtors')
      .select('id', { count: 'exact', head: true })
      .eq('branch_list_id', dupId)
    if ((leftDebtors ?? 0) > 0) {
      return safeClientError('تعذّر الحذف: ما زال هناك مدينون مرتبطون بالمكرر', 409)
    }

    const { error: delErr } = await admin.from('branch_lists').delete().eq('id', dupId)
    if (delErr) {
      return apiServerError('merge-branch-lists:delete', delErr, 'فشل حذف القائمة المكررة')
    }
  }

  const { error: nameErr } = await admin
    .from('branch_lists')
    .update({ name: displayName, normalized_name: key })
    .eq('id', canonicalId)

  if (nameErr && String(nameErr.message ?? '').includes('normalized_name')) {
    const { error: nameOnly } = await admin
      .from('branch_lists')
      .update({ name: displayName })
      .eq('id', canonicalId)
    if (nameOnly) return apiServerError('merge-branch-lists:name', nameOnly, 'فشل تحديث اسم القائمة')
  } else if (nameErr) {
    return apiServerError('merge-branch-lists:name', nameErr, 'فشل تحديث اسم القائمة')
  }

  await logActivity({
    action: 'update_debtor',
    entity_type: 'branch_list',
    entity_id: canonicalId,
    description: `دمج قوائم مكررة إلى «${displayName}» (نُقل ${debtorsMoved} مدين، ${delegatesMoved} مندوب)`,
  }, auth.supabase)

  return NextResponse.json({
    ok: true,
    canonicalId,
    displayName,
    debtorsMoved,
    delegatesMoved,
    deletedIds: duplicateIds,
  })
}
