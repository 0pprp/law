import { rejectTaskExpenses } from '@/lib/expense-wallet'
import { extractGpsFromCompletion, finalizeTaskApproval, FEE_STATUS_AWAITING_NEXT_TASK } from '@/lib/task-approval'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function rejectTaskCompletion(
  supabase: SupabaseClient,
  taskId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = reason.trim()
  if (!trimmed) return { ok: false, error: 'يجب إدخال سبب الرفض' }

  const { data: task } = await supabase
    .from('tasks')
    .select('id, task_status, fee_status')
    .eq('id', taskId)
    .maybeSingle()

  if (!task) return { ok: false, error: 'المهمة غير موجودة' }

  if (task.task_status !== 'submitted' && task.task_status !== 'pending_review') {
    return { ok: false, error: 'لا يمكن رفض مهمة خارج طابور المراجعة' }
  }

  if ((task as { fee_status?: string | null }).fee_status === FEE_STATUS_AWAITING_NEXT_TASK) {
    return { ok: false, error: 'المهمة معتمدة الإنجاز — أنشئ المهمة التالية أو ألغِ الاعتماد من المسار الصحيح' }
  }

  // مصدر الحقيقة: needs_revision (يظهر في تبويب مرفوضة والعدادات)
  // rejected احتياطي فقط إن لم يدعم الـ enum القيمة needs_revision
  const payloads = [
    { task_status: 'needs_revision', admin_notes: trimmed },
    { task_status: 'rejected', admin_notes: trimmed },
  ]

  let lastErr: { message?: string } | null = null
  for (const payload of payloads) {
    const { data: updated, error: err } = await supabase
      .from('tasks')
      .update(payload as any)
      .eq('id', taskId)
      .in('task_status', ['submitted', 'pending_review'])
      .select('id')
    if (!err) {
      if (!updated?.length) {
        return { ok: false, error: 'تغيّرت حالة المهمة — أعد التحميل' }
      }
      await rejectTaskExpenses(supabase, taskId)
      return { ok: true }
    }
    lastErr = err
  }

  return { ok: false, error: lastErr?.message ?? 'فشل رفض المهمة' }
}

export interface TaskTransitionParams {
  taskId: string
  action: 'next' | 'close'
  nextTaskDefId?: string
  updateGps?: boolean
  userId: string
}

export async function applyTaskTransition(
  supabase: SupabaseClient,
  params: TaskTransitionParams,
): Promise<{ ok: boolean; error?: string }> {
  const { taskId, action, nextTaskDefId, updateGps, userId } = params

  const { data: task, error: taskErr } = await supabase
    .from('tasks')
    .select(`
      id, debtor_id, branch_id, task_type, task_definition_id, completion_data, task_status, fee_status,
      task_definitions ( label, fee_amount )
    `)
    .eq('id', taskId)
    .single()

  if (taskErr || !task) {
    return { ok: false, error: taskErr?.message ?? 'المهمة غير موجودة' }
  }

  if (!['approved', 'completed'].includes((task as any).task_status as string)) {
    return { ok: false, error: 'يجب اعتماد إنجاز المهمة أولاً قبل إنشاء المهمة التالية' }
  }

  const awaitingFinalization = (task as any).fee_status === FEE_STATUS_AWAITING_NEXT_TASK

  let debtor: {
    id: string
    full_name: string
    branch_id: string | null
    latitude: number | null
    longitude: number | null
    current_task_id: string | null
    last_task_id: string | null
    case_status: string | null
  } | null = null

  if (task.debtor_id) {
    const { data: debtorRow, error: debtorErr } = await supabase
      .from('debtors')
      .select('id, full_name, branch_id, latitude, longitude, current_task_id, last_task_id, case_status')
      .eq('id', task.debtor_id)
      .maybeSingle()

    if (debtorErr) {
      return { ok: false, error: debtorErr.message }
    }
    debtor = debtorRow
  }

  // منع التكرار: إن لم تعد هذه المهمة الحالية للمدين فقد نُفِّذ الإجراء اللاحق مسبقاً
  if (debtor) {
    const alreadyMoved =
      (debtor.current_task_id != null && debtor.current_task_id !== task.id)
      || debtor.last_task_id === task.id
      || debtor.case_status === 'closed'
      || debtor.case_status === 'payment_in_progress'
    if (alreadyMoved) {
      return { ok: false, error: 'تم تنفيذ الإجراء اللاحق لهذه المهمة مسبقاً' }
    }
  }

  const branchId = task.branch_id ?? debtor?.branch_id ?? null

  const { data: gpsFields } = await supabase
    .from('task_required_fields')
    .select('field_key')
    .eq('task_definition_id', task.task_definition_id)
    .eq('field_type', 'gps')

  const gpsKeys = (gpsFields ?? []).map(f => f.field_key)
  const completionData = (task.completion_data ?? {}) as Record<string, string>
  const newGps = extractGpsFromCompletion(completionData, gpsKeys)
  const hasExistingGps = debtor?.latitude != null && debtor?.longitude != null
  const debtorIdForGps = task.debtor_id as string | null

  async function saveGpsIfNeeded(): Promise<{ ok: boolean; error?: string }> {
    if (!newGps || !debtorIdForGps) return { ok: true }
    if (hasExistingGps && !updateGps) return { ok: true }
    const { error } = await supabase.from('debtors').update({
      latitude: newGps.lat,
      longitude: newGps.lng,
      location_captured_at: new Date().toISOString(),
    }).eq('id', debtorIdForGps)
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  if (action === 'close') {
    const closedAt = new Date().toISOString()
    const closePayloads: Record<string, unknown>[] = [
      { case_status: 'closed', closed_at: closedAt, current_task_id: null, last_task_id: task.id },
      { case_status: 'closed', closed_at: closedAt, current_task_id: null },
      { status: 'closed', closed_at: closedAt, current_task_id: null, last_task_id: task.id },
      { status: 'closed', closed_at: closedAt, current_task_id: null },
    ]
    let closeErr: { message?: string } | null = null
    for (const payload of closePayloads) {
      const { error: err } = await supabase.from('debtors').update(payload as any).eq('id', task.debtor_id)
      if (!err) { closeErr = null; break }
      closeErr = err
    }
    if (closeErr) {
      return { ok: false, error: closeErr.message ?? 'خطأ في إغلاق القضية' }
    }

    // الإغلاق مهمة ختامية: الاعتماد النهائي واحتساب الأتعاب هنا (مرة واحدة)
    if (awaitingFinalization) {
      const finalizeResult = await finalizeTaskApproval(supabase, task.id, userId)
      if (!finalizeResult.ok) {
        // تراجع عن الإغلاق — تبقى المهمة بانتظار الإجراء اللاحق بلا آثار مالية
        await supabase.from('debtors').update({
          case_status: debtor?.case_status ?? 'active',
          closed_at: null,
          current_task_id: debtor?.current_task_id ?? task.id,
          last_task_id: debtor?.last_task_id ?? null,
        } as any).eq('id', task.debtor_id)
        return { ok: false, error: finalizeResult.error ?? 'فشل الاعتماد النهائي واحتساب الأتعاب' }
      }
    }

    // GPS فقط بعد نجاح الإغلاق — لا يُحفظ جزئياً عند الفشل
    const gpsResult = await saveGpsIfNeeded()
    if (!gpsResult.ok) {
      return { ok: false, error: gpsResult.error ?? 'فشل حفظ موقع GPS بعد الإغلاق' }
    }
    return { ok: true }
  }

  if (!nextTaskDefId) {
    return { ok: false, error: 'يجب اختيار المهمة اللاحقة' }
  }

  const gpsBeforeNext = await saveGpsIfNeeded()
  if (!gpsBeforeNext.ok) {
    return { ok: false, error: gpsBeforeNext.error ?? 'فشل حفظ موقع GPS' }
  }

  const { data: nextDef } = await supabase
    .from('task_definitions')
    .select('id, label, fee_amount, task_type, case_type')
    .eq('id', nextTaskDefId)
    .maybeSingle()

  const { data: debtorRow } = await supabase
    .from('debtors')
    .select('case_type')
    .eq('id', task.debtor_id)
    .maybeSingle()
  const debtorCase = debtorRow?.case_type === 'criminal' ? 'criminal' : 'civil'
  const nextCase = nextDef?.case_type === 'criminal' ? 'criminal' : 'civil'
  if (nextCase !== debtorCase) {
    return { ok: false, error: 'المهمة اللاحقة يجب أن تطابق نوع دعوى المدين' }
  }

  const { data: newTask, error: insertErr } = await supabase.from('tasks').insert({
    debtor_id: task.debtor_id,
    task_definition_id: nextTaskDefId,
    task_type: nextDef?.task_type ?? null,
    task_status: 'waiting_assignment',
    assigned_to: null,
    reward_amount: nextDef?.fee_amount ?? 0,
    branch_id: branchId,
    created_by: userId,
  } as any).select('id').single()

  if (insertErr || !newTask) {
    return { ok: false, error: insertErr?.message ?? 'فشل إنشاء المهمة اللاحقة' }
  }

  const { error: linkErr } = await supabase
    .from('debtors')
    .update({ current_task_id: newTask.id, last_task_id: task.id, case_status: 'active' } as any)
    .eq('id', task.debtor_id)

  if (linkErr) {
    await supabase.from('tasks').delete().eq('id', newTask.id)
    return { ok: false, error: linkErr.message }
  }

  // الاعتماد النهائي واحتساب الأتعاب — فقط بعد نجاح إنشاء المهمة التالية وربطها
  if (awaitingFinalization) {
    const finalizeResult = await finalizeTaskApproval(supabase, task.id, userId)
    if (!finalizeResult.ok) {
      // تراجع كامل: حذف المهمة الجديدة وإرجاع مؤشرات المدين — لا آثار مالية
      await supabase
        .from('debtors')
        .update({
          current_task_id: debtor?.current_task_id ?? task.id,
          last_task_id: debtor?.last_task_id ?? null,
          case_status: debtor?.case_status ?? 'active',
        } as any)
        .eq('id', task.debtor_id)
      await supabase.from('tasks').delete().eq('id', newTask.id)
      return { ok: false, error: finalizeResult.error ?? 'فشل الاعتماد النهائي — لم تُنشأ المهمة التالية' }
    }
  }

  return { ok: true }
}

export async function assignTasksViaApi(
  taskIds: string[],
  lawyerId: string,
  dueDate?: string,
): Promise<{ ok: boolean; error: string | null }> {
  const res = await fetch('/api/admin/assign-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskIds, lawyerId, dueDate }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? 'فشل تكليف المهمة' }
  }
  return { ok: true, error: null }
}

export async function rejectTaskViaApi(
  taskId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/admin/reject-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, reason }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? 'فشل رفض المهمة' }
  }
  return { ok: true }
}

export async function taskTransitionViaApi(
  params: Omit<TaskTransitionParams, 'userId'>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/admin/task-transition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? 'فشل تحديث المرحلة' }
  }
  return { ok: true }
}
