import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyTaskTransition } from '@/lib/task-operations-api'
import {
  canApproveCompletions,
  apiForbiddenResponse,
  isAccountant,
  isGeneralAccountant,
} from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const profile = await fetchStaffRoleFields(supabase, user.id)

    if (!canApproveCompletions(profile?.role)) {
      return apiForbiddenResponse()
    }

    const body = await request.json().catch(() => ({}))
    const taskId = body.taskId as string | undefined
    const action = body.action as 'next' | 'close' | undefined

    if (!taskId || !action || !['next', 'close'].includes(action)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 })
    }

    const admin = createAdminClient()

    // نفس نطاق فرع اعتماد/رفض الإنجاز
    const branchScoped = (isAccountant(profile!.role) && !isGeneralAccountant(profile!.role, profile!.accountant_type))
      || profile!.role === 'employee'
    if (branchScoped) {
      if (!profile!.branch_id) return apiForbiddenResponse()
      const { data: taskRow } = await admin.from('tasks').select('branch_id').eq('id', taskId).single()
      if (!taskRow?.branch_id || taskRow.branch_id !== profile!.branch_id) {
        return apiForbiddenResponse()
      }
    }

    const result = await applyTaskTransition(admin, {
      taskId,
      action,
      nextTaskDefId: body.nextTaskDefId as string | undefined,
      updateGps: Boolean(body.updateGps),
      userId: user.id,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل تحديث المرحلة' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/task-transition]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
