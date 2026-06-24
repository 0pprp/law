import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { acceptTaskAssignment, rejectTaskAssignment } from '@/lib/task-assignment'
import { formatErrorMessage } from '@/lib/format-error'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { taskId, action, reason } = body as { taskId?: string; action?: string; reason?: string }

    if (!taskId || !action) {
      return NextResponse.json({ error: 'بيانات الطلب غير مكتملة' }, { status: 400 })
    }

    const { data: task } = await supabase
      .from('tasks')
      .select('id, assigned_to, task_status')
      .eq('id', taskId)
      .single()

    if (!task || task.assigned_to !== user.id) {
      return NextResponse.json({ error: 'المهمة غير موجودة أو غير مكلفة لك' }, { status: 404 })
    }

    if (task.task_status !== 'assignment_pending_acceptance') {
      return NextResponse.json({ error: 'لا يوجد طلب تكليف بانتظار الرد على هذه المهمة' }, { status: 400 })
    }

    if (action === 'accept') {
      const { error } = await acceptTaskAssignment(supabase, taskId)
      if (error) return NextResponse.json({ error: formatErrorMessage(error) }, { status: 400 })
      return NextResponse.json({ success: true })
    }

    if (action === 'reject') {
      if (!reason?.trim()) {
        return NextResponse.json({ error: 'سبب الرفض مطلوب' }, { status: 400 })
      }
      const { error } = await rejectTaskAssignment(supabase, taskId, reason)
      if (error) return NextResponse.json({ error: formatErrorMessage(error) }, { status: 400 })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'إجراء غير معروف' }, { status: 400 })
  } catch (e: unknown) {
    console.error('[lawyer/task-assignment]', e)
    return NextResponse.json({ error: formatErrorMessage(e) }, { status: 500 })
  }
}
