import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rejectTaskCompletion } from '@/lib/task-operations-api'
import { STAFF_ROLES, canApproveCompletions, apiForbiddenResponse } from '@/lib/permissions'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !STAFF_ROLES.includes(profile.role) || !canApproveCompletions(profile.role)) {
      return apiForbiddenResponse()
    }

    const body = await request.json().catch(() => ({}))
    const taskId = body.taskId as string | undefined
    const reason = body.reason as string | undefined

    if (!taskId || !reason?.trim()) {
      return NextResponse.json({ error: 'معرّف المهمة وسبب الرفض مطلوبان' }, { status: 400 })
    }

    const admin = createAdminClient()
    const result = await rejectTaskCompletion(admin, taskId, reason)

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل رفض المهمة' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/reject-task]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
