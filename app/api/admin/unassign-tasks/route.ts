import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { unassignTasksToWaiting } from '@/lib/task-assignment'
import { canAssignTasks, apiForbiddenResponse } from '@/lib/permissions'
import { requireTaskInScope } from '@/lib/section-guard'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error

    if (!canAssignTasks(auth.profile?.role)) {
      return apiForbiddenResponse()
    }

    const body = await request.json().catch(() => ({}))
    const taskIds = Array.isArray(body.taskIds) ? (body.taskIds as string[]) : []
    const reason = typeof body.reason === 'string' ? body.reason : null

    if (!taskIds.length) {
      return NextResponse.json({ error: 'حدد مهمة واحدة على الأقل' }, { status: 400 })
    }
    if (taskIds.length > 100) {
      return NextResponse.json({ error: 'الحد الأقصى 100 مهمة في العملية الواحدة' }, { status: 400 })
    }

    const admin = createAdminClient()
    const scope = sessionCaseScope(auth.profile)

    for (const taskId of taskIds) {
      const gate = await requireTaskInScope(admin, scope, String(taskId))
      if (!gate.ok) return gate.error
    }

    const result = await unassignTasksToWaiting(admin, taskIds, { reason })
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل إلغاء التكليف' }, { status: 400 })
    }

    return NextResponse.json({ ok: true, updatedIds: result.updatedIds })
  } catch (e) {
    console.error('[admin/unassign-tasks]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
