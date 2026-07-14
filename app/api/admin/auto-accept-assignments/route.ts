import { NextResponse } from 'next/server'
import { requireStaffProfile } from '@/lib/api-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { autoAcceptExpiredAssignments } from '@/lib/task-assignment'

/** موافقة تلقائية لكل الفروع — يوم بعد تاريخ التكليف → مكلفة */
export async function POST() {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  try {
    const admin = createAdminClient()
    let accepted = 0
    // دفعات حتى لا يتوقف عند حد 500 لكل الفروع
    for (let i = 0; i < 20; i++) {
      const n = await autoAcceptExpiredAssignments(admin)
      accepted += n
      if (n < 500) break
    }
    return NextResponse.json({ ok: true, accepted })
  } catch (e) {
    console.error('[auto-accept-assignments]', e)
    return NextResponse.json({ error: 'فشل الموافقة التلقائية' }, { status: 500 })
  }
}
