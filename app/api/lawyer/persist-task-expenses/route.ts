import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkLawyerTaskAccess } from '@/lib/lawyer-task-access'
import { persistTaskExpensesDirect, type PendingTaskExpense } from '@/lib/persist-task-expenses'
import { safeClientError } from '@/lib/safe-api-error'

/**
 * حفظ صرفيات المهمة عند إرسال الإنجاز — service role بعد التحقق من التكليف.
 * يحل فشل RLS للمحامي العام عند العمل على فرع غير فرعه.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    let body: {
      taskId?: unknown
      debtorId?: unknown
      caseId?: unknown
      branchId?: unknown
      rows?: unknown
      caseType?: unknown
    }
    try {
      body = await request.json()
    } catch {
      return safeClientError('طلب غير صالح', 400)
    }

    const taskId = String(body.taskId ?? '').trim()
    const debtorId = String(body.debtorId ?? '').trim()
    if (!taskId || !debtorId) {
      return safeClientError('المهمة والمدين مطلوبان', 400)
    }

    const access = await checkLawyerTaskAccess(supabase, user.id, taskId)
    if (!access.ok) {
      return NextResponse.json({ error: 'المهمة غير متاحة' }, { status: 403 })
    }

    const task = access.task as { debtor_id?: string | null; branch_id?: string | null; case_id?: string | null }
    if (task.debtor_id && task.debtor_id !== debtorId) {
      return NextResponse.json({ error: 'المدين لا يطابق المهمة' }, { status: 403 })
    }

    const rows = Array.isArray(body.rows) ? (body.rows as PendingTaskExpense[]) : []
    const admin = createAdminClient()
    const result = await persistTaskExpensesDirect(admin, {
      taskId,
      debtorId,
      caseId: (body.caseId as string | null | undefined) ?? task.case_id ?? null,
      branchId: (body.branchId as string | null | undefined) ?? task.branch_id ?? access.branchId,
      lawyerId: user.id,
      rows,
      caseType: typeof body.caseType === 'string' ? body.caseType : null,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'فشل حفظ الصرفيات' }, { status: 400 })
    }

    return NextResponse.json({ ok: true, count: result.count, total: result.total })
  } catch (e) {
    console.error('[api/lawyer/persist-task-expenses]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
