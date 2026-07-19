import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { releaseLawyerFee } from '@/lib/task-approval'
import {
  canApproveCompletions,
  apiForbiddenResponse,
  isAccountant,
  isGeneralAccountant,
} from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'

/**
 * مسار قديم — احتساب الأتعاب يتم الآن عبر finalizeTaskApproval بعد المهمة التالية.
 * يُرفض إذا كانت المهمة بانتظار إنشاء المهمة التالية (approved_pending_next).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const profile = await fetchStaffRoleFields(supabase, user.id)

    if (!canApproveCompletions(profile?.role)) {
      return apiForbiddenResponse()
    }

    const { taskId } = await request.json().catch(() => ({}))
    if (!taskId) {
      return NextResponse.json({ error: 'معرّف المهمة مطلوب' }, { status: 400 })
    }

    const admin = createAdminClient()

    const branchScoped = (isAccountant(profile!.role) && !isGeneralAccountant(profile!.role, profile!.accountant_type))
      || profile!.role === 'employee'
    if (branchScoped) {
      const { data: taskRow } = await admin.from('tasks').select('branch_id, fee_status').eq('id', taskId).single()
      if (!taskRow?.branch_id || taskRow.branch_id !== profile!.branch_id) {
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

    const result = await releaseLawyerFee(admin, taskId, user.id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل صرف أتعاب المحامي' }, { status: 400 })
    }

    return NextResponse.json({ ok: true, amount: result.amount })
  } catch (e) {
    console.error('[admin/release-task-fee]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
