import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCanDeleteProfile } from '@/lib/api-auth'
import { PERMISSION_DENIED_MSG } from '@/lib/permissions'
import { logActivity } from '@/lib/activity-log'
import { createClient } from '@/lib/supabase/server'
import { deleteStaffUserAccount } from '@/lib/delete-staff-user'
import { formatErrorMessage } from '@/lib/format-error'

const DELETABLE_ROLES = new Set(['lawyer', 'delegate', 'accountant', 'employee', 'viewer'])

async function handleDelete(request: NextRequest) {
  const ctx = await requireCanDeleteProfile()
  if (ctx.error) return ctx.error

  const body = await request.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' ? body.userId : ''
  if (!userId) {
    return NextResponse.json({ error: 'معرّف المستخدم مطلوب' }, { status: 400 })
  }

  if (userId === ctx.user!.id) {
    return NextResponse.json({ error: 'لا يمكنك حذف حسابك' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: target, error: targetErr } = await admin
    .from('profiles')
    .select('id, full_name, role, username')
    .eq('id', userId)
    .maybeSingle()

  if (targetErr) {
    return NextResponse.json({ error: formatErrorMessage(targetErr) }, { status: 400 })
  }
  if (!target) {
    return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })
  }

  if (target.role === 'admin') {
    return NextResponse.json({ error: 'لا يمكن حذف حساب مدير' }, { status: 403 })
  }

  if (!DELETABLE_ROLES.has(target.role)) {
    return NextResponse.json({ error: PERMISSION_DENIED_MSG }, { status: 403 })
  }

  const result = await deleteStaffUserAccount(admin, userId)
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'فشل حذف الحساب' }, { status: 400 })
  }

  const supabase = await createClient()
  const roleLabel = target.role === 'delegate' ? 'مندوب' : 'مستخدم'
  await logActivity({
    action: target.role === 'delegate' ? 'delete_delegate' : 'delete_user',
    entity_type: target.role === 'delegate' ? 'delegate' : 'profile',
    entity_id: userId,
    description: `حذف ${roleLabel}: ${target.full_name}${target.username ? ` (${target.username})` : ''}`,
  }, supabase)

  return NextResponse.json({ ok: true })
}

export async function POST(request: NextRequest) {
  try {
    return await handleDelete(request)
  } catch (e) {
    console.error('[admin/delete-user]', e)
    return NextResponse.json({ error: formatErrorMessage(e) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    return await handleDelete(request)
  } catch (e) {
    console.error('[admin/delete-user]', e)
    return NextResponse.json({ error: formatErrorMessage(e) }, { status: 500 })
  }
}
