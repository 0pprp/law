import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canAddDebtorExpenses, canApproveCompletions } from '@/lib/permissions'
import { requireTaskInScope } from '@/lib/section-guard'
import { deductTaskExpensesOnApproval } from '@/lib/expense-wallet'
import { finalizeTaskApproval, FEE_STATUS_AWAITING_NEXT_TASK } from '@/lib/task-approval'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'

const APPROVED = new Set(['approved', 'completed'])

/**
 * اعتماد صرفيات مهمة بقيت معلّقة بعد إنجاز المهمة (مهام مرتبطة / فشل الخصم).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canApproveCompletions(auth.profile?.role) && !canAddDebtorExpenses(auth.profile?.role)) {
    return apiForbiddenResponse()
  }

  let body: { taskId?: unknown }
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const taskId = String(body.taskId ?? '').trim()
  if (!taskId) return safeClientError('معرّف المهمة مطلوب', 400)

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireTaskInScope(admin, scope, taskId)
  if (!gate.ok) return gate.error

  const { data: task, error } = await admin
    .from('tasks')
    .select('id, task_status, fee_status, assigned_to')
    .eq('id', taskId)
    .maybeSingle()

  if (error) return apiServerError('approve-task-expenses load', error)
  if (!task) return safeClientError('المهمة غير موجودة', 404)

  if (!APPROVED.has(String(task.task_status))) {
    return safeClientError('صرفيات المهام تُعتمد عند اعتماد الإنجاز من مراجعة المهام', 400)
  }

  const reviewerId = auth.user!.id
  if (task.fee_status === FEE_STATUS_AWAITING_NEXT_TASK) {
    const fin = await finalizeTaskApproval(admin, taskId, reviewerId, {
      task_status: task.task_status,
      fee_status: task.fee_status,
      assigned_to: task.assigned_to,
    })
    if (!fin.ok) return safeClientError(fin.error ?? 'فشل اعتماد صرفيات المهمة', 400)
    return NextResponse.json({ ok: true })
  }

  const deducted = await deductTaskExpensesOnApproval(admin, taskId, reviewerId, {
    lawyerId: task.assigned_to,
  })
  if (!deducted.ok) return safeClientError(deducted.error ?? 'فشل خصم صرفيات المهمة', 400)

  return NextResponse.json({ ok: true })
}
