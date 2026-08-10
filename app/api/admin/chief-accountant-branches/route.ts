import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, isAdmin } from '@/lib/permissions'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'

const MAX_BRANCHES = 100

function parseBranchIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const ids = [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))]
  return ids.slice(0, MAX_BRANCHES)
}

/**
 * مزامنة فروع المحاسب الرئيسي (استبدال كامل للقائمة).
 * المدير فقط.
 * PUT { profileId, branchIds: string[] }
 */
export async function PUT(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!isAdmin(auth.profile?.role)) return apiForbiddenResponse()

  let body: { profileId?: unknown; branchIds?: unknown }
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const profileId = String(body.profileId ?? '').trim()
  if (!profileId) return safeClientError('معرّف الحساب مطلوب', 400)

  const branchIds = parseBranchIds(body.branchIds)
  if (branchIds == null) return safeClientError('قائمة الفروع مطلوبة', 400)

  const admin = createAdminClient()

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, role, full_name')
    .eq('id', profileId)
    .maybeSingle()
  if (profileErr) return apiServerError('chief-branches:profile', profileErr)
  if (!profile) return safeClientError('الحساب غير موجود', 404)
  if (profile.role !== 'chief_accountant') {
    return safeClientError('الحساب ليس محاسباً رئيسياً', 400)
  }

  if (branchIds.length) {
    const { data: validBranches, error: brErr } = await admin
      .from('branches')
      .select('id')
      .in('id', branchIds)
    if (brErr) return apiServerError('chief-branches:validate', brErr)
    if ((validBranches ?? []).length !== branchIds.length) {
      return safeClientError('بعض الفروع المحددة غير صالحة', 400)
    }
  }

  const { error: delErr } = await admin
    .from('chief_accountant_branches')
    .delete()
    .eq('profile_id', profileId)
  if (delErr) {
    if (String(delErr.message ?? '').includes('chief_accountant_branches')) {
      return safeClientError('جدول فروع المحاسب الرئيسي غير مفعّل بعد — طبّق الهجرة', 400)
    }
    return apiServerError('chief-branches:delete', delErr)
  }

  if (branchIds.length) {
    const { error: insErr } = await admin.from('chief_accountant_branches').insert(
      branchIds.map(branch_id => ({ profile_id: profileId, branch_id })),
    )
    if (insErr) return apiServerError('chief-branches:insert', insErr)
  }

  await logActivity({
    action: 'sync_chief_accountant_branches',
    entity_type: 'profile',
    entity_id: profileId,
    description: `تحديث فروع المحاسب الرئيسي «${profile.full_name}»: ${branchIds.length} فرع`,
    metadata: { branchIds, count: branchIds.length },
  }, auth.supabase)

  return NextResponse.json({ ok: true, count: branchIds.length, branchIds })
}

/** قراءة فروع محاسب رئيسي */
export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!isAdmin(auth.profile?.role)) return apiForbiddenResponse()

  const profileId = String(request.nextUrl.searchParams.get('profileId') ?? '').trim()
  if (!profileId) return safeClientError('معرّف الحساب مطلوب', 400)

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('chief_accountant_branches')
    .select('branch_id, branches:branches(id, name)')
    .eq('profile_id', profileId)

  if (error) {
    if (String(error.message ?? '').includes('chief_accountant_branches')) {
      return NextResponse.json({ branches: [] })
    }
    return apiServerError('chief-branches:list', error)
  }

  const branches = (data ?? []).map(row => {
    const b = Array.isArray(row.branches) ? row.branches[0] : row.branches
    return { id: row.branch_id as string, name: (b as { name?: string } | null)?.name ?? row.branch_id }
  }).filter(b => b.id)

  return NextResponse.json({ branches })
}
