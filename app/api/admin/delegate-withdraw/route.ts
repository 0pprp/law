import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isAdmin } from '@/lib/permissions'
import { withdrawDelegateAvailable } from '@/lib/delegate-wallet'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!isAdmin(callerProfile?.role)) {
    return NextResponse.json({ error: 'السحب متاح للمدير فقط' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const delegateId = typeof body.delegateId === 'string' ? body.delegateId.trim() : ''
  const amount = Number(body.amount)
  const notes = typeof body.notes === 'string' ? body.notes : undefined

  if (!delegateId) {
    return NextResponse.json({ error: 'معرّف المندوب مطلوب' }, { status: 400 })
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'المبلغ غير صالح' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: delegate } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', delegateId)
    .maybeSingle()

  if (!delegate || delegate.role !== 'delegate') {
    return NextResponse.json({ error: 'المندوب غير موجود' }, { status: 404 })
  }

  const result = await withdrawDelegateAvailable(admin, delegateId, amount, user.id, notes)
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'فشل السحب' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
