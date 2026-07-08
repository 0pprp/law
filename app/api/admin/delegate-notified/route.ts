import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canManageDelegateFees } from '@/lib/permissions'
import { normalizeDebtorNotified, type DebtorNotifiedStatus } from '@/lib/delegate'
import { setDebtorNotifiedStatus } from '@/lib/delegate-wallet'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!canManageDelegateFees(callerProfile?.role)) {
    return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : ''
  const statusRaw = typeof body.status === 'string' ? body.status : ''

  if (!taskId) {
    return NextResponse.json({ error: 'معرّف المهمة مطلوب' }, { status: 400 })
  }

  const status = normalizeDebtorNotified(statusRaw) as DebtorNotifiedStatus
  if (statusRaw !== 'unset' && statusRaw !== 'yes' && statusRaw !== 'no') {
    return NextResponse.json({ error: 'حالة التبليغ غير صالحة' }, { status: 400 })
  }

  const admin = createAdminClient()
  const result = await setDebtorNotifiedStatus(admin, taskId, status, user.id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'فشل تحديث حالة التبليغ' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
