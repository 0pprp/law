import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import {
  apiForbiddenResponse,
  canDeleteSpecialStatuses,
  canManageSpecialStatuses,
} from '@/lib/permissions'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'
import { isValidSpecialStatusColor, normalizeSpecialStatusColor } from '@/lib/special-statuses'

function parseName(value: unknown): string | null {
  const name = String(value ?? '').trim()
  if (!name || name.length > 80) return null
  return name
}

type Admin = ReturnType<typeof createAdminClient>

async function countDebtorsForStatus(admin: Admin, statusId: string): Promise<number> {
  const { count, error } = await admin
    .from('debtors')
    .select('id', { count: 'exact', head: true })
    .eq('special_status_id', statusId)
  if (error) return 0
  return count ?? 0
}

/** نسخ الصفة بنفس الاسم في كل الفروع — الصفة الواحدة تُنشأ لكل فرع */
async function siblingIdsByName(admin: Admin, name: string): Promise<string[]> {
  const { data } = await admin.from('special_statuses').select('id').eq('name', name)
  return (data ?? []).map(r => r.id as string)
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canManageSpecialStatuses(auth.profile?.role)) return apiForbiddenResponse()

  const { searchParams } = new URL(request.url)
  const branchId = searchParams.get('branchId')?.trim() || null
  const viewAll = searchParams.get('viewAll') === '1'

  const admin = createAdminClient()
  let q = admin
    .from('special_statuses')
    .select('id, branch_id, name, color, sort_order, is_active, created_at')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  const aggregate = viewAll || !branchId
  if (!aggregate) q = q.eq('branch_id', branchId)

  const { data, error } = await q
  if (error) return apiServerError('special-statuses:get', error)

  const rows = data ?? []
  const withCounts = await Promise.all(rows.map(async row => ({
    ...row,
    color: normalizeSpecialStatusColor(row.color),
    ids: [row.id as string],
    debtor_count: await countDebtorsForStatus(admin, row.id),
  })))

  if (!aggregate) return NextResponse.json({ statuses: withCounts })

  // «كل الفروع»: نفس الصفة موجودة بكل فرع — أرجع نسخة واحدة بالاسم مع مجموع المدينين
  type Group = (typeof withCounts)[number]
  const groups = new Map<string, Group>()
  for (const row of withCounts) {
    const key = String(row.name ?? '').trim()
    const prev = groups.get(key)
    if (!prev) {
      groups.set(key, { ...row, name: key })
      continue
    }
    prev.ids.push(row.id)
    prev.debtor_count += row.debtor_count
    prev.sort_order = Math.min(Number(prev.sort_order ?? 0), Number(row.sort_order ?? 0))
    // النسخة النشطة هي الممثلة للمجموعة
    if (!prev.is_active && row.is_active) {
      prev.id = row.id
      prev.branch_id = row.branch_id
      prev.color = row.color
      prev.is_active = true
    }
  }

  const statuses = [...groups.values()].sort(
    (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || a.name.localeCompare(b.name, 'ar'),
  )

  return NextResponse.json({ statuses })
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canManageSpecialStatuses(auth.profile?.role)) return apiForbiddenResponse()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const name = parseName(body.name)
  if (!name) return safeClientError('اسم الصفة مطلوب (80 حرفاً كحد أقصى)', 400)
  if (!isValidSpecialStatusColor(body.color)) return safeClientError('لون الصفة غير صالح', 400)
  const color = normalizeSpecialStatusColor(String(body.color))

  const viewAll = body.viewAll === true || body.viewAll === '1'
  const branchId = String(body.branchId ?? '').trim() || null

  const admin = createAdminClient()
  const branchIds: string[] = []

  if (viewAll) {
    const { data: branches, error } = await admin.from('branches').select('id').eq('is_active', true)
    if (error) return apiServerError('special-statuses:branches', error)
    for (const b of branches ?? []) branchIds.push(b.id)
  } else if (branchId) {
    branchIds.push(branchId)
  } else {
    return safeClientError('معرّف الفرع مطلوب', 400)
  }

  const created: unknown[] = []
  for (const bId of branchIds) {
    const { data: maxRow } = await admin
      .from('special_statuses')
      .select('sort_order')
      .eq('branch_id', bId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()

    const sort_order = Number(maxRow?.sort_order ?? 0) + 1
    const { data: row, error } = await admin
      .from('special_statuses')
      .insert({ branch_id: bId, name, color, sort_order, is_active: true })
      .select('id, branch_id, name, color, sort_order, is_active')
      .single()

    if (error) {
      if (error.code === '23505') continue
      return apiServerError('special-statuses:create', error)
    }
    if (row) created.push(row)
  }

  if (!created.length) return safeClientError('تعذر إنشاء الصفة — قد يكون الاسم مكرراً', 409)

  await logActivity({
    action: 'create_special_status',
    entity_type: 'special_status',
    description: `إضافة للأسماء التي تحتاج مراقبة: ${name}`,
    metadata: { name, color, branches: branchIds.length },
  }, auth.supabase)

  return NextResponse.json({ ok: true, created })
}

export async function PATCH(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canManageSpecialStatuses(auth.profile?.role)) return apiForbiddenResponse()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const id = String(body.id ?? '').trim()
  if (!id) return safeClientError('معرّف الصفة مطلوب', 400)

  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) {
    const name = parseName(body.name)
    if (!name) return safeClientError('اسم الصفة غير صالح', 400)
    patch.name = name
  }
  if (body.color !== undefined) {
    if (!isValidSpecialStatusColor(body.color)) return safeClientError('لون الصفة غير صالح', 400)
    patch.color = normalizeSpecialStatusColor(String(body.color))
  }
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active)
  if (body.sort_order !== undefined) {
    const n = Number(body.sort_order)
    if (!Number.isFinite(n)) return safeClientError('ترتيب غير صالح', 400)
    patch.sort_order = Math.round(n)
  }

  if (!Object.keys(patch).length) return safeClientError('لا توجد حقول للتحديث', 400)

  const admin = createAdminClient()
  const { data: current } = await admin
    .from('special_statuses')
    .select('id, name')
    .eq('id', id)
    .maybeSingle()
  if (!current) return safeClientError('الصفة غير موجودة', 404)

  const viewAll = body.viewAll === true || body.viewAll === '1'
  const targetIds = viewAll ? await siblingIdsByName(admin, current.name) : [id]
  if (!targetIds.includes(id)) targetIds.push(id)

  const { data: rows, error } = await admin
    .from('special_statuses')
    .update(patch)
    .in('id', targetIds)
    .select('id, branch_id, name, color, sort_order, is_active')

  if (error) return apiServerError('special-statuses:patch', error)
  const row = (rows ?? []).find(r => r.id === id) ?? (rows ?? [])[0]
  if (!row) return safeClientError('الصفة غير موجودة', 404)

  await logActivity({
    action: 'update_special_status',
    entity_type: 'special_status',
    entity_id: id,
    description: `تعديل الأسماء التي تحتاج مراقبة: ${row.name}`,
    metadata: { ...patch, branches: targetIds.length },
  }, auth.supabase)

  return NextResponse.json({ ok: true, status: row, updated: rows?.length ?? 0 })
}

export async function DELETE(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canDeleteSpecialStatuses(auth.profile?.role)) return apiForbiddenResponse()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const id = String(body.id ?? '').trim()
  if (!id) return safeClientError('معرّف الصفة مطلوب', 400)

  const admin = createAdminClient()
  const { data: row } = await admin.from('special_statuses').select('id, name').eq('id', id).maybeSingle()
  if (!row) return safeClientError('الصفة غير موجودة', 404)

  const viewAll = body.viewAll === true || body.viewAll === '1'
  const targetIds = viewAll ? await siblingIdsByName(admin, row.name) : [id]
  if (!targetIds.includes(id)) targetIds.push(id)

  const counts = await Promise.all(targetIds.map(sid => countDebtorsForStatus(admin, sid)))
  const linked = counts.reduce((sum, n) => sum + n, 0)
  if (linked > 0) {
    return NextResponse.json({
      error: `لا يمكن حذف الصفة — ${linked} مدين مرتبط بها. أزل الصفة عن المدينين أولاً.`,
    }, { status: 409 })
  }

  const { error } = await admin.from('special_statuses').delete().in('id', targetIds)
  if (error) return apiServerError('special-statuses:delete', error)

  await logActivity({
    action: 'delete_special_status',
    entity_type: 'special_status',
    entity_id: id,
    description: `حذف من الأسماء التي تحتاج مراقبة: ${row.name}`,
    metadata: { branches: targetIds.length },
  }, auth.supabase)

  return NextResponse.json({ ok: true, deleted: targetIds.length })
}
