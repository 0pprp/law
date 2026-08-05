import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { canApproveCompletions, apiForbiddenResponse, isAccountant, isGeneralAccountant } from '@/lib/permissions'
import { requireTaskInScope } from '@/lib/section-guard'
import { isIncompleteCompletionRequest } from '@/lib/incomplete-completion'
import { logActivity } from '@/lib/activity-log'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error
    if (!canApproveCompletions(auth.profile?.role)) return apiForbiddenResponse()

    const body = await request.json().catch(() => ({}))
    const taskId = body.taskId as string | undefined
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!taskId) return NextResponse.json({ error: 'معرّف المهمة مطلوب' }, { status: 400 })
    if (!reason) return NextResponse.json({ error: 'يجب إدخال سبب الرفض' }, { status: 400 })

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
      .select('id, task_status, assigned_to, completion_data, incomplete_request, incomplete_reason')
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

    if (!task.assigned_to) {
      return NextResponse.json({ error: 'المهمة بلا مكلّف — لا يمكن رفض الطلب مع الإبقاء على التكليف' }, { status: 400 })
    }

    // تبقى مكلفة لنفس المحامي مع رسالة الرفض
    const payloads = [
      {
        task_status: 'needs_revision',
        admin_notes: reason,
        incomplete_request: false,
        incomplete_reason: null,
        completed_at: null,
        completion_data: null,
      },
      {
        task_status: 'rejected',
        admin_notes: reason,
        incomplete_request: false,
        incomplete_reason: null,
        completed_at: null,
        completion_data: null,
      },
    ]

    let lastErr: { message?: string } | null = null
    for (const payload of payloads) {
      const { data: updated, error } = await admin
        .from('tasks')
        .update(payload as any)
        .eq('id', taskId)
        .in('task_status', ['submitted', 'pending_review'])
        .eq('assigned_to', task.assigned_to)
        .select('id')
      if (!error) {
        if (!updated?.length) {
          return NextResponse.json({ error: 'تغيّرت حالة المهمة — أعد التحميل' }, { status: 409 })
        }
        await logActivity({
          action: 'reject_incomplete_task',
          entity_type: 'task',
          entity_id: taskId,
          description: `رفض إرسال بدون إنجاز — السبب: ${reason}`,
        }, auth.supabase)
        return NextResponse.json({ ok: true })
      }
      lastErr = error
      // إن فشل بسبب أعمدة incomplete_* غير موجودة — أعد بدونها
      if (/incomplete_request|incomplete_reason/i.test(error.message ?? '')) {
        const { data: updated2, error: err2 } = await admin
          .from('tasks')
          .update({
            task_status: payload.task_status,
            admin_notes: reason,
            completed_at: null,
            completion_data: null,
          } as any)
          .eq('id', taskId)
          .in('task_status', ['submitted', 'pending_review'])
          .eq('assigned_to', task.assigned_to)
          .select('id')
        if (!err2 && updated2?.length) {
          await logActivity({
            action: 'reject_incomplete_task',
            entity_type: 'task',
            entity_id: taskId,
            description: `رفض إرسال بدون إنجاز — السبب: ${reason}`,
          }, auth.supabase)
          return NextResponse.json({ ok: true })
        }
        lastErr = err2
      }
    }

    return NextResponse.json({ error: lastErr?.message ?? 'فشل رفض الطلب' }, { status: 400 })
  } catch (e) {
    console.error('[admin/reject-incomplete-task]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
