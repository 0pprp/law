import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { canStaffReadBranch, canStaffWriteBranch } from '@/lib/staff-branch-access'
import {
  apiForbiddenResponse,
  canAddDebtor,
  canAssignTasks,
} from '@/lib/permissions'
import { logActivity } from '@/lib/activity-log'
import { requireDebtorInScope } from '@/lib/section-guard'

/** حالات تسمح بتغيير تعريف المهمة قبل التكليف/الإنجاز */
const EDITABLE_STATUSES = new Set([
  'waiting_assignment',
  'pending_assignment',
  'draft',
  'new',
])

export async function POST(request: NextRequest) {
  // مسؤول القانونية مسموح هنا (canAssignTasks) — تعيين المهمة المطلوبة جزء من صلاحيات التكليف
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const role = auth.profile?.role
  if (!canAddDebtor(role) && !canAssignTasks(role)) {
    return apiForbiddenResponse()
  }

  let body: { debtorId?: string; taskDefinitionId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const debtorId = String(body.debtorId ?? '').trim()
  const taskDefinitionId = String(body.taskDefinitionId ?? '').trim()
  if (!debtorId || !taskDefinitionId) {
    return NextResponse.json({ error: 'المدين والمهمة مطلوبان' }, { status: 400 })
  }

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(
    admin,
    scope,
    debtorId,
    'id, branch_id, current_task_id, full_name, case_status, case_type',
  )
  if (!gate.ok) return gate.error

  const debtor = gate.data as {
    id: string
    branch_id: string | null
    current_task_id: string | null
    full_name: string | null
    case_status: string | null
    case_type?: string
  }

  if (debtor.case_status === 'closed') {
    return NextResponse.json({ error: 'لا يمكن تعديل مهمة قضية مغلقة' }, { status: 400 })
  }
  // من يملك صلاحية التكليف (مدير/موظف/مسؤول قانونية) يكفيه وصول قراءة للفرع،
  // والمحاسب (إضافة مدين) يبقى مقيداً بكتابة فرعه الحالي
  const branchAllowed = canAssignTasks(role)
    ? canStaffReadBranch(auth.profile, debtor.branch_id)
    : canStaffWriteBranch(auth.profile, debtor.branch_id)
  if (!branchAllowed) {
    return apiForbiddenResponse()
  }

  const debtorCaseType = gate.caseType

  const { data: def, error: defErr } = await admin
    .from('task_definitions')
    .select('id, label, task_type, fee_amount, branch_id, is_active, case_type')
    .eq('id', taskDefinitionId)
    .maybeSingle()

  if (defErr || !def || !def.is_active) {
    return NextResponse.json({ error: 'تعريف المهمة غير موجود أو غير نشط' }, { status: 404 })
  }
  if (def.branch_id !== debtor.branch_id) {
    return NextResponse.json({ error: 'المهمة يجب أن تكون من نفس فرع المدين' }, { status: 400 })
  }
  const defCaseType = (def as { case_type?: string }).case_type === 'criminal' ? 'criminal' : 'civil'
  if (defCaseType !== debtorCaseType) {
    return NextResponse.json({ error: 'تعريف المهمة لا يطابق نوع دعوى المدين' }, { status: 400 })
  }

  const fee = debtorCaseType === 'criminal' ? 0 : (Number(def.fee_amount) || 0)

  if (!debtor.current_task_id) {
    const { data: created, error: createErr } = await admin
      .from('tasks')
      .insert({
        debtor_id: debtor.id,
        task_definition_id: def.id,
        task_type: def.task_type,
        task_status: 'waiting_assignment',
        reward_amount: fee,
        branch_id: debtor.branch_id,
      })
      .select('id')
      .single()

    if (createErr || !created) {
      console.error('[change-debtor-task:create]', createErr?.message)
      return NextResponse.json({ error: 'فشل إنشاء المهمة' }, { status: 500 })
    }

    await admin.from('debtors').update({ current_task_id: created.id }).eq('id', debtor.id)
    await logActivity({
      action: 'update_task',
      entity_type: 'debtor',
      entity_id: debtor.id,
      description: `تعيين المهمة المطلوبة: ${def.label}`,
      case_type: gate.caseType,
    }, auth.supabase)

    return NextResponse.json({ ok: true, taskId: created.id, label: def.label })
  }

  const { data: task, error: taskErr } = await admin
    .from('tasks')
    .select('id, task_status, task_definition_id, assigned_to, branch_id')
    .eq('id', debtor.current_task_id)
    .maybeSingle()

  if (taskErr || !task) {
    return NextResponse.json({ error: 'المهمة الحالية غير موجودة' }, { status: 404 })
  }

  if (!EDITABLE_STATUSES.has(task.task_status)) {
    return NextResponse.json({
      error: 'لا يمكن تغيير المهمة بعد التكليف أو الإنجاز — فقط قبل التكليف',
    }, { status: 400 })
  }

  if (task.task_definition_id === def.id) {
    return NextResponse.json({ ok: true, taskId: task.id, label: def.label, unchanged: true })
  }

  const { error: updErr } = await admin
    .from('tasks')
    .update({
      task_definition_id: def.id,
      task_type: def.task_type,
      reward_amount: fee,
      assigned_to: null,
      task_status: 'waiting_assignment',
      due_date: null,
    })
    .eq('id', task.id)

  if (updErr) {
    console.error('[change-debtor-task:update]', updErr.message)
    return NextResponse.json({ error: 'فشل تحديث المهمة' }, { status: 500 })
  }

  await logActivity({
    action: 'update_task',
    entity_type: 'task',
    entity_id: task.id,
    description: `تغيير المهمة المطلوبة للمدين ${debtor.full_name ?? ''}: ${def.label}`,
    case_type: gate.caseType,
  }, auth.supabase)

  return NextResponse.json({ ok: true, taskId: task.id, label: def.label })
}
