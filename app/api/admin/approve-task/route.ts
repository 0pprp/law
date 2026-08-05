import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { approveTaskCompletion } from '@/lib/task-approval'
import { applyTaskTransition } from '@/lib/task-operations-api'
import { resolvePleadingDefIdForLawsuit } from '@/lib/default-next-task'
import { isAccountant, canApproveCompletions, apiForbiddenResponse, isGeneralAccountant } from '@/lib/permissions'
import { requireTaskInScope } from '@/lib/section-guard'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error

    if (!canApproveCompletions(auth.profile?.role)) {
      return apiForbiddenResponse()
    }

    const body = await request.json().catch(() => ({}))
    const taskId = body.taskId as string | undefined
    if (!taskId) {
      return NextResponse.json({ error: 'معرّف المهمة مطلوب' }, { status: 400 })
    }

    const admin = createAdminClient()
    const scope = sessionCaseScope(auth.profile)
    const gate = await requireTaskInScope(admin, scope, taskId)
    if (!gate.ok) return gate.error

    const profile = auth.profile!
    const branchScoped = (isAccountant(profile.role) && !isGeneralAccountant(profile.role, profile.accountant_type))
      || profile.role === 'employee'
    if (branchScoped) {
      if (!profile.branch_id) {
        return apiForbiddenResponse()
      }
      const taskBranch = (gate.data.task as { branch_id?: string | null }).branch_id
      if (!taskBranch || taskBranch !== profile.branch_id) {
        return apiForbiddenResponse()
      }
    }

    const result = await approveTaskCompletion(admin, taskId, auth.user!.id)

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل اعتماد الإنجاز' }, { status: 400 })
    }

    // إقامة دعوى → مرافعات تلقائياً (إن وُجد التعريف)
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
          userId: auth.user!.id,
        })
        autoNext = transition.ok
          ? { ok: true, nextLabel: pleading.label }
          : { ok: false, error: transition.error, nextLabel: pleading.label }
      }
    }

    return NextResponse.json({
      ok: true,
      feeAmount: result.feeAmount,
      legalManagerBonus: result.legalManagerBonus ?? 0,
      autoNext,
    })
  } catch (e) {
    console.error('[admin/approve-task]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
