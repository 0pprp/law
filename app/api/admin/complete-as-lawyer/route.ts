import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { approveTaskCompletion, finalizeTaskApproval } from '@/lib/task-approval'
import { applyTaskTransition, isNextActionAlreadyDoneError } from '@/lib/task-operations-api'
import { resolvePleadingDefIdForLawsuit } from '@/lib/default-next-task'
import { persistTaskExpensesDirect, type PendingTaskExpense } from '@/lib/persist-task-expenses'
import { unassignTasksToWaiting } from '@/lib/task-assignment'
import { buildIncompleteCompletionData } from '@/lib/incomplete-completion'
import {
  canApproveCompletions,
  apiForbiddenResponse,
  isAccountant,
  isGeneralAccountant,
} from '@/lib/permissions'
import { requireTaskInScope } from '@/lib/section-guard'
import { logActivity } from '@/lib/activity-log'
import {
  isMissingHybridSchema,
  partitionCompletionDataByDefinition,
} from '@/lib/hybrid-task-links'

const COMPLETABLE = new Set([
  'assignment_pending_acceptance',
  'assigned',
  'in_progress',
  'new',
  'rejected',
  'needs_info',
  'needs_revision',
])

type HybridLinkBody = {
  linked_definition_id?: string
  label?: string
  fee_amount?: number
  task_type?: string | null
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error
    if (!canApproveCompletions(auth.profile?.role)) return apiForbiddenResponse()

    const body = await request.json().catch(() => ({})) as {
      taskId?: string
      completionData?: Record<string, string>
      rawCompletion?: Record<string, string>
      pendingExpenses?: PendingTaskExpense[]
      hybridParentDefinitionId?: string | null
      hybridSelectedLinked?: HybridLinkBody[]
      incomplete?: boolean
      incompleteReason?: string
    }

    const taskId = String(body.taskId ?? '').trim()
    if (!taskId) return NextResponse.json({ error: 'معرّف المهمة مطلوب' }, { status: 400 })

    const admin = createAdminClient()
    const scope = sessionCaseScope(auth.profile)
    const gate = await requireTaskInScope(admin, scope, taskId)
    if (!gate.ok) return gate.error

    const profile = auth.profile!
    const branchScoped =
      (isAccountant(profile.role) && !isGeneralAccountant(profile.role, profile.accountant_type))
      || profile.role === 'employee'
    if (branchScoped) {
      if (!profile.branch_id) return apiForbiddenResponse()
      const taskBranch = (gate.data.task as { branch_id?: string | null }).branch_id
      if (!taskBranch || taskBranch !== profile.branch_id) return apiForbiddenResponse()
    }

    const { data: task, error: taskErr } = await admin
      .from('tasks')
      .select('id, task_status, assigned_to, debtor_id, branch_id, case_id, task_type, task_definition_id, lawyer_notes, legal_result, task_definitions(label)')
      .eq('id', taskId)
      .maybeSingle()
    if (taskErr || !task) {
      return NextResponse.json({ error: 'المهمة غير موجودة' }, { status: 404 })
    }
    if (!task.assigned_to) {
      return NextResponse.json({ error: 'المهمة غير مكلّفة لمحامٍ' }, { status: 400 })
    }
    if (!COMPLETABLE.has(String(task.task_status))) {
      return NextResponse.json({ error: 'لا يمكن إنجاز هذه المهمة بحالتها الحالية' }, { status: 400 })
    }

    const completionData = (body.completionData && typeof body.completionData === 'object')
      ? body.completionData
      : {}
    const rawCompletion = (body.rawCompletion && typeof body.rawCompletion === 'object')
      ? body.rawCompletion
      : completionData
    const nowIso = new Date().toISOString()
    const reviewerId = auth.user!.id
    const lawyerId = task.assigned_to as string

    if (task.task_status === 'assignment_pending_acceptance') {
      const acceptPayloads = [
        { task_status: 'assigned', accepted_at: nowIso, acceptance_method: 'admin_proxy' },
        { task_status: 'assigned', accepted_at: nowIso },
        { task_status: 'assigned' },
      ]
      let accepted = false
      let acceptErr: { message?: string } | null = null
      for (const payload of acceptPayloads) {
        const { error } = await admin
          .from('tasks')
          .update(payload as any)
          .eq('id', taskId)
          .eq('task_status', 'assignment_pending_acceptance')
        if (!error) {
          accepted = true
          break
        }
        acceptErr = error
      }
      if (!accepted) {
        return NextResponse.json({ error: acceptErr?.message ?? 'فشل قبول التكليف' }, { status: 400 })
      }
    }

    if (body.incomplete) {
      const reason = String(body.incompleteReason ?? '').trim()
      if (!reason) {
        return NextResponse.json({ error: 'يجب إدخال سبب الإرسال بدون إنجاز' }, { status: 400 })
      }
      const completionDataInc = buildIncompleteCompletionData(reason)
      await admin
        .from('tasks')
        .update({
          lawyer_notes: reason,
          completion_data: completionDataInc,
          incomplete_request: true,
          incomplete_reason: reason,
        } as any)
        .eq('id', taskId)

      const statusNow = String(task.task_status)
      if (statusNow === 'new' || statusNow === 'needs_info') {
        await admin.from('tasks').update({ task_status: 'assigned' } as any).eq('id', taskId)
      }

      const unassign = await unassignTasksToWaiting(admin, [taskId], {
        reason: `إرسال بدون إنجاز من الإدارة: ${reason}`,
      })
      if (!unassign.ok) {
        return NextResponse.json({ error: unassign.error ?? 'فشل إلغاء التكليف' }, { status: 400 })
      }

      await logActivity({
        action: 'admin_incomplete_as_lawyer',
        entity_type: 'task',
        entity_id: taskId,
        description: `إرسال بدون إنجاز من الإدارة نيابة عن المحامي — ${reason}`,
      }, admin)

      return NextResponse.json({ ok: true, incomplete: true, needsNextTask: false })
    }

    const expenses = Array.isArray(body.pendingExpenses) ? body.pendingExpenses : []
    if (expenses.length && task.debtor_id) {
      const exp = await persistTaskExpensesDirect(admin, {
        taskId,
        debtorId: task.debtor_id,
        caseId: task.case_id ?? null,
        branchId: task.branch_id ?? null,
        lawyerId,
        rows: expenses,
      })
      if (!exp.ok) {
        return NextResponse.json({ error: exp.error ?? 'فشل حفظ الصرفيات' }, { status: 400 })
      }
    }

    const parentCompletion = completionData
    const baseUpdate = {
      lawyer_notes: parentCompletion.note || task.lawyer_notes || null,
      legal_result: parentCompletion.legal_result || task.legal_result || null,
      completion_data: parentCompletion,
      completed_at: nowIso,
    }

    let saved = false
    for (const status of ['submitted', 'pending_review'] as const) {
      const { error } = await admin
        .from('tasks')
        .update({ ...baseUpdate, task_status: status } as any)
        .eq('id', taskId)
      if (!error) {
        saved = true
        break
      }
    }
    if (!saved) {
      return NextResponse.json({ error: 'فشل حفظ بيانات الإنجاز' }, { status: 500 })
    }

    const hybridParentDefinitionId = body.hybridParentDefinitionId?.trim() || null
    const hybridLinks = Array.isArray(body.hybridSelectedLinked) ? body.hybridSelectedLinked : []
    const childIds: string[] = []
    if (hybridParentDefinitionId && hybridLinks.length) {
      const defIds = [
        hybridParentDefinitionId,
        ...hybridLinks.map(l => String(l.linked_definition_id ?? '')).filter(Boolean),
      ]
      const partitioned = partitionCompletionDataByDefinition(rawCompletion, defIds)
      for (const link of hybridLinks) {
        const linkedId = String(link.linked_definition_id ?? '').trim()
        if (!linkedId) continue
        const childCompletion = partitioned[linkedId] ?? {}
        const basePayload: Record<string, unknown> = {
          debtor_id: task.debtor_id,
          branch_id: task.branch_id ?? null,
          task_definition_id: linkedId,
          task_type: link.task_type ?? task.task_type ?? null,
          assigned_to: lawyerId,
          task_status: 'submitted',
          reward_amount: Number(link.fee_amount) || 0,
          completion_data: childCompletion,
          completed_at: nowIso,
          created_by: reviewerId,
          lawyer_notes: childCompletion.note || null,
          legal_result: childCompletion.legal_result || null,
        }
        const withParent = { ...basePayload, hybrid_parent_task_id: taskId }
        let insertedId: string | null = null
        let { data: inserted, error: insErr } = await admin
          .from('tasks')
          .insert(withParent as any)
          .select('id')
        if (insErr && isMissingHybridSchema(insErr.message)) {
          ;({ data: inserted, error: insErr } = await admin
            .from('tasks')
            .insert(basePayload as any)
            .select('id'))
        }
        if (insErr) {
          return NextResponse.json(
            { error: `فشل إنشاء المهمة المرتبطة «${link.label ?? ''}»: ${insErr.message}` },
            { status: 400 },
          )
        }
        insertedId = inserted?.[0]?.id ? String(inserted[0].id) : null
        if (insertedId) childIds.push(insertedId)
      }
    }

    for (const childId of childIds) {
      const childApprove = await approveTaskCompletion(admin, childId, reviewerId)
      if (!childApprove.ok) {
        return NextResponse.json(
          { error: childApprove.error ?? 'فشل اعتماد المهمة المرتبطة' },
          { status: 400 },
        )
      }
      const childFinal = await finalizeTaskApproval(admin, childId, reviewerId)
      if (!childFinal.ok) {
        return NextResponse.json(
          { error: childFinal.error ?? 'فشل احتساب أتعاب المهمة المرتبطة' },
          { status: 400 },
        )
      }
    }

    const approve = await approveTaskCompletion(admin, taskId, reviewerId)
    if (!approve.ok) {
      return NextResponse.json({ error: approve.error ?? 'فشل الاعتماد التلقائي' }, { status: 400 })
    }

    let autoNext: { ok: boolean; nextLabel?: string; error?: string } | null = null
    const { data: approvedTask } = await admin
      .from('tasks')
      .select('id, task_type, branch_id, debtor_id, task_definitions(label)')
      .eq('id', taskId)
      .maybeSingle()
    if (approvedTask) {
      const pleading = await resolvePleadingDefIdForLawsuit(admin, approvedTask as any)
      if (pleading) {
        const transition = await applyTaskTransition(admin, {
          taskId,
          action: 'next',
          nextTaskDefId: pleading.defId,
          userId: reviewerId,
        })
        autoNext = (transition.ok || isNextActionAlreadyDoneError(transition.error))
          ? { ok: true, nextLabel: pleading.label }
          : { ok: false, error: transition.error, nextLabel: pleading.label }
      }
    }

    await logActivity({
      action: 'admin_complete_as_lawyer',
      entity_type: 'task',
      entity_id: taskId,
      description: 'إنجاز من الإدارة نيابة عن المحامي — اعتماد تلقائي',
    }, admin)

    return NextResponse.json({
      ok: true,
      autoNext,
      needsNextTask: !autoNext?.ok,
    })
  } catch (e) {
    console.error('[admin/complete-as-lawyer]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
