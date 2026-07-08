import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { approveTaskCompletion } from '@/lib/task-approval'
import { STAFF_ROLES, isAccountant, canApproveCompletions, apiForbiddenResponse, isGeneralAccountant } from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const profile = await fetchStaffRoleFields(supabase, user.id)

    if (!profile?.role || !STAFF_ROLES.includes(profile.role as typeof STAFF_ROLES[number])) {
      return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
    }

    if (!canApproveCompletions(profile.role)) {
      return apiForbiddenResponse()
    }

    const body = await request.json().catch(() => ({}))
    const taskId = body.taskId as string | undefined
    if (!taskId) {
      return NextResponse.json({ error: 'معرّف المهمة مطلوب' }, { status: 400 })
    }

    const admin = createAdminClient()

    const branchScoped = (isAccountant(profile.role) && !isGeneralAccountant(profile.role, profile.accountant_type))
      || profile.role === 'employee'
    if (branchScoped) {
      const { data: taskRow } = await admin.from('tasks').select('branch_id').eq('id', taskId).single()
      if (!taskRow?.branch_id || taskRow.branch_id !== profile.branch_id) {
        return apiForbiddenResponse()
      }
    }

    const result = await approveTaskCompletion(admin, taskId, user.id)

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل اعتماد الإنجاز' }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      feeAmount: result.feeAmount,
      legalManagerBonus: result.legalManagerBonus ?? 0,
    })
  } catch (e) {
    console.error('[admin/approve-task]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
