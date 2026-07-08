import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireCanDeleteProfile } from '@/lib/api-auth'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity-log'

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireCanDeleteProfile()
    if (ctx.error) return ctx.error

    const body = await request.json().catch(() => ({}))
    const userId = typeof body.userId === 'string' ? body.userId : ''
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : null

    if (!userId || isActive === null) {
      return NextResponse.json({ error: 'بيانات غير مكتملة' }, { status: 400 })
    }

    if (userId === ctx.user!.id) {
      return NextResponse.json({ error: 'لا يمكنك تغيير حالة حسابك' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: target, error: targetErr } = await admin
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', userId)
      .maybeSingle()

    if (targetErr || !target) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 })
    }

    if (target.role === 'admin') {
      return NextResponse.json({ error: 'لا يمكن تغيير حالة حساب مدير' }, { status: 403 })
    }

    const { error: updateErr } = await admin.from('profiles').update({ is_active: isActive }).eq('id', userId)
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message ?? 'فشل التحديث' }, { status: 400 })
    }

    const supabase = await createClient()
    const isDelegate = target.role === 'delegate'
    await logActivity({
      action: isActive
        ? (isDelegate ? 'activate_delegate' : 'activate_lawyer')
        : (isDelegate ? 'deactivate_delegate' : 'deactivate_lawyer'),
      entity_type: isDelegate ? 'delegate' : 'lawyer',
      entity_id: userId,
      description: `${isActive ? 'تفعيل' : 'تعطيل'} ${isDelegate ? 'مندوب' : 'حساب'}: ${target.full_name}`,
    }, supabase)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/toggle-user-active]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
