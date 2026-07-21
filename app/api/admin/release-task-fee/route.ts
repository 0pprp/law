import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { releaseLawyerFee } from '@/lib/task-approval'
import {
  canApproveCompletions,
  apiForbiddenResponse,
  isAccountant,
  isGeneralAccountant,
} from '@/lib/permissions'
import { requireTaskInScope } from '@/lib/section-guard'

/**
 * مسار قديم — احتساب الأتعاب يتم الآن عبر finalizeTaskApproval بعد المهمة التالية.
 * يُرفض إذا كانت المهمة بانتظار إنشاء المهمة التالية (approved_pending_next).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error

    if (!canApproveCompletions(auth.profile?.role)) {
      return apiForbiddenResponse()
    }

    const { taskId } = await request.json().catch(() => ({}))
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
      const { data: taskRow } = await admin.from('tasks').select('branch_id, fee_status').eq('id', taskId).single()
      if (!taskRow?.branch_id || taskRow.branch_id !== profile.branch_id) {
        return apiForbiddenResponse()
      }
      if ((taskRow as { fee_status?: string | null }).fee_status === 'approved_pending_next') {
        return NextResponse.json({
          error: 'لا تُحتسب الأتعاب قبل إنشاء المهمة التالية — استخدم مسار اعتماد المهمة التالي',
        }, { status: 400 })
      }
    } else {
      const { data: taskRow } = await admin.from('tasks').select('fee_status').eq('id', taskId).maybeSingle()
      if ((taskRow as { fee_status?: string | null } | null)?.fee_status === 'approved_pending_next') {
        return NextResponse.json({
          error: 'لا تُحتسب الأتعاب قبل إنشاء المهمة التالية — استخدم مسار اعتماد المهمة التالي',
        }, { status: 400 })
      }
    }

    const result = await releaseLawyerFee(admin, taskId, auth.user!.id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل صرف أتعاب المحامي' }, { status: 400 })
    }

    return NextResponse.json({ ok: true, amount: result.amount })
  } catch (e) {
    console.error('[admin/release-task-fee]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
