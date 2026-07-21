import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { rejectTaskCompletion } from '@/lib/task-operations-api'
import {
  canApproveCompletions,
  apiForbiddenResponse,
  isAccountant,
  isGeneralAccountant,
} from '@/lib/permissions'
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
    const reason = body.reason as string | undefined

    if (!taskId || !reason?.trim()) {
      return NextResponse.json({ error: 'معرّف المهمة وسبب الرفض مطلوبان' }, { status: 400 })
    }

    const admin = createAdminClient()
    const scope = sessionCaseScope(auth.profile)
    const gate = await requireTaskInScope(admin, scope, taskId)
    if (!gate.ok) return gate.error

    const profile = auth.profile!
    // نفس منطق approve-task: المستخدم المقيّد بفرع لا يرفض مهام فرع آخر
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
