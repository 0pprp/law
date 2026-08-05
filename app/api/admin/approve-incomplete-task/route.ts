import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { canApproveCompletions, apiForbiddenResponse, isAccountant, isGeneralAccountant } from '@/lib/permissions'
import { requireTaskInScope } from '@/lib/section-guard'
import { unassignTasksToWaiting } from '@/lib/task-assignment'
import { isIncompleteCompletionRequest, readIncompleteReason } from '@/lib/incomplete-completion'
import { logActivity } from '@/lib/activity-log'
import { FEE_STATUS_AWAITING_NEXT_TASK } from '@/lib/task-approval'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error
    if (!canApproveCompletions(auth.profile?.role)) return apiForbiddenResponse()

    const body = await request.json().catch(() => ({}))
    const taskId = body.taskId as string | undefined
    if (!taskId) return NextResponse.json({ error: 'معرّف المهمة مطلوب' }, { status: 400 })

    const admin = createAdminClient()
    const scope = sessionCaseScope(auth.profile)
    const gate = await requireTaskInScope(admin, scope, taskId)
    if (!gate.ok) return gate.error

    const profile = auth.profile!
    const branchScoped = (isAccountant(profile.role) && !isGeneralAccountant(profile.role, profile.accountant_type))
      || profile.role === 'employee'
    if (branchScoped) {
      if (!profile.branch_id) return apiForbiddenResponse()
      const taskBranch = (gate.data.task as { branch_id?: string | null }).branch_id
      if (!taskBranch || taskBranch !== profile.branch_id) return apiForbiddenResponse()
    }

    const { data: task, error: loadErr } = await admin
      .from('tasks')
      .select('id, task_status, assigned_to, fee_status, completion_data, incomplete_request, incomplete_reason, lawyer_notes, debtor_id, task_type')
      .eq('id', taskId)
      .maybeSingle()

    if (loadErr || !task) {
      return NextResponse.json({ error: loadErr?.message ?? 'المهمة غير موجودة' }, { status: 404 })
    }

    if (!['submitted', 'pending_review'].includes(String(task.task_status))) {
      return NextResponse.json({ error: 'المهمة ليست في طابور المراجعة' }, { status: 400 })
    }

    if (!isIncompleteCompletionRequest(task as any)) {
      return NextResponse.json({ error: 'هذه ليست طلب إرسال بدون إنجاز' }, { status: 400 })
    }

    if ((task as { fee_status?: string | null }).fee_status === FEE_STATUS_AWAITING_NEXT_TASK) {
      return NextResponse.json({ error: 'لا يمكن اعتماد طلب غير منجز لمهمة بانتظار المهمة التالية' }, { status: 400 })
    }

    const reason = readIncompleteReason(task as any) || 'اعتماد إرسال بدون إنجاز — إلغاء التكليف'
    const result = await unassignTasksToWaiting(admin, [taskId], {
      reason: `اعتماد بدون إنجاز: ${reason}`,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل إلغاء التكليف' }, { status: 400 })
    }

    // تأكيد مسح علامة الطلب إن بقيت بعد unassign
    try {
      await admin
        .from('tasks')
        .update({
          incomplete_request: false,
          incomplete_reason: null,
        } as any)
        .eq('id', taskId)
    } catch {
      // أعمدة قد لا تكون موجودة — الإلغاء عبر completion_data كافٍ
    }

    await logActivity({
      action: 'approve_incomplete_task',
      entity_type: 'task',
      entity_id: taskId,
      description: `اعتماد إرسال بدون إنجاز وإلغاء التكليف — السبب: ${reason}`,
    }, auth.supabase)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/approve-incomplete-task]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
