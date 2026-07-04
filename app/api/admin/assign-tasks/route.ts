import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assignTasksToLawyer } from '@/lib/task-assignment'
import { STAFF_ROLES, canAssignTasks, apiForbiddenResponse } from '@/lib/permissions'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, branch_id')
      .eq('id', user.id)
      .single()

    if (!profile || !STAFF_ROLES.includes(profile.role) || !canAssignTasks(profile.role)) {
      return apiForbiddenResponse()
    }

    const body = await request.json().catch(() => ({}))
    const taskIds = Array.isArray(body.taskIds) ? body.taskIds as string[] : []
    const lawyerId = body.lawyerId as string | undefined
    const dueDate = body.dueDate as string | undefined

    if (!taskIds.length || !lawyerId) {
      return NextResponse.json({ error: 'المهام والمحامي مطلوبان' }, { status: 400 })
    }

    const admin = createAdminClient()
    const result = await assignTasksToLawyer(admin, taskIds, lawyerId, dueDate, user.id)

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل تكليف المهمة' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[admin/assign-tasks]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
