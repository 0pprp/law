import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { assignTasksToLawyer, validateLawyerTaskAssignment } from '@/lib/task-assignment'
import { canAssignTasks, apiForbiddenResponse } from '@/lib/permissions'
import { requireTaskInScope } from '@/lib/section-guard'
import { endDualForAssignedTasks } from '@/lib/pleading-notification-twin'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error

    if (!canAssignTasks(auth.profile?.role)) {
      return apiForbiddenResponse()
    }

    const body = await request.json().catch(() => ({}))
    const taskIds = Array.isArray(body.taskIds) ? body.taskIds as string[] : []
    const lawyerId = body.lawyerId as string | undefined
    const dueDate = body.dueDate as string | undefined

    if (!taskIds.length || !lawyerId) {
      return NextResponse.json({ error: 'المهام والمحامي مطلوبان' }, { status: 400 })
    }

    const admin = createAdminClient()
    const scope = sessionCaseScope(auth.profile)

    for (const taskId of taskIds) {
      const gate = await requireTaskInScope(admin, scope, String(taskId))
      if (!gate.ok) return gate.error
    }

    const validation = await validateLawyerTaskAssignment(admin, lawyerId, taskIds)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error ?? 'تعذر التحقق من التكليف' }, { status: 400 })
    }

    const { data: assignRows, error: hybridPeekErr } = await admin
      .from('tasks')
      .select('id, hybrid_parent_task_id')
      .in('id', taskIds)
    if (!hybridPeekErr) {
      const idSet = new Set(taskIds.map(String))
      if ((assignRows ?? []).some(r => r.hybrid_parent_task_id && idSet.has(String(r.hybrid_parent_task_id)))) {
        return NextResponse.json(
          { error: 'يمكن تكليف مهمة واحدة فقط — المرافعات أو التبليغ، ليس الاثنين معاً في نفس العملية' },
          { status: 400 },
        )
      }
    }

    const result = await assignTasksToLawyer(admin, taskIds, lawyerId, dueDate, auth.user!.id)

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل تكليف المهمة' }, { status: 400 })
    }

    await endDualForAssignedTasks(admin, taskIds).catch((e) =>
      console.warn('[admin/assign-tasks:twin]', e),
    )

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/assign-tasks]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
