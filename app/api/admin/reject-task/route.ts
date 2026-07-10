import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rejectTaskCompletion } from '@/lib/task-operations-api'
import {
  STAFF_ROLES,
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

    if (!profile?.role || !STAFF_ROLES.includes(profile.role as typeof STAFF_ROLES[number])) {
      return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
    }

    if (!canApproveCompletions(profile.role)) {
      return apiForbiddenResponse()
    }

    const body = await request.json().catch(() => ({}))
    const taskId = body.taskId as string | undefined
    const reason = body.reason as string | undefined

    if (!taskId || !reason?.trim()) {
      return NextResponse.json({ error: 'معرّف المهمة وسبب الرفض مطلوبان' }, { status: 400 })
    }

    const admin = createAdminClient()

    // نفس منطق approve-task: المستخدم المقيّد بفرع لا يرفض مهام فرع آخر
    const branchScoped = (isAccountant(profile.role) && !isGeneralAccountant(profile.role, profile.accountant_type))
      || profile.role === 'employee'
    if (branchScoped) {
      if (!profile.branch_id) {
        return apiForbiddenResponse()
      }
      const { data: taskRow } = await admin.from('tasks').select('branch_id').eq('id', taskId).single()
      if (!taskRow?.branch_id || taskRow.branch_id !== profile.branch_id) {
        return apiForbiddenResponse()
      }
    }

    const result = await rejectTaskCompletion(admin, taskId, reason)

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل رفض المهمة' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/reject-task]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
