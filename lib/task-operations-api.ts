import { rejectTaskExpenses } from '@/lib/expense-wallet'
import { extractHearingDateFromCompletion } from '@/lib/hearing-date-from-completion'
import { extractGpsFromCompletion, finalizeTaskApproval, FEE_STATUS_AWAITING_NEXT_TASK } from '@/lib/task-approval'
import { isPleadingDefinition } from '@/lib/default-next-task'
import { endPleadingNotificationDual, ensurePleadingNotificationTwin } from '@/lib/pleading-notification-twin'
import type { SupabaseClient } from '@supabase/supabase-js'

/** خطأ التكرار من applyTaskTransition — يُعامل كنجاح idempotent في الواجهة */
export function isNextActionAlreadyDoneError(error: string | null | undefined): boolean {
  return String(error ?? '').includes('تم تنفيذ الإجراء اللاحق')
}

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
      id, debtor_id, branch_id, task_type, task_definition_id, completion_data, task_status, fee_status, assigned_to,
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
  const completionData = (task.completion_data ?? {}) as Record<string, string>
  const debtorId = task.debtor_id as string | null

  // قراءة متوازية: المدين + حقول GPS + تعريف المهمة التالية
  const [debtorRes, gpsRes, nextDefRes] = await Promise.all([
    debtorId
      ? supabase
          .from('debtors')
          .select('id, full_name, branch_id, latitude, longitude, current_task_id, last_task_id, case_status, case_type')
          .eq('id', debtorId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null as { message?: string } | null }),
    task.task_definition_id
      ? supabase
          .from('task_required_fields')
          .select('field_key')
          .eq('task_definition_id', task.task_definition_id)
          .eq('field_type', 'gps')
      : Promise.resolve({ data: [] as { field_key: string }[] }),
    action === 'next' && nextTaskDefId
      ? supabase
          .from('task_definitions')
          .select('id, label, fee_amount, task_type, case_type')
          .eq('id', nextTaskDefId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  if (debtorRes.error) {
    return { ok: false, error: debtorRes.error.message }
  }

  const debtor = debtorRes.data as {
    id: string
    full_name: string
    branch_id: string | null
    latitude: number | null
    longitude: number | null
    current_task_id: string | null
    last_task_id: string | null
    case_status: string | null
    case_type: string | null
  } | null

  // منع التكرار: فقط إذا انتقلت القضية فعلاً عن هذه المهمة
  // ملاحظة: last_task_id === task.id مع بقاء current_task_id = task.id حالة بيانات فاسدة
  // ولا تعني أن المهمة التالية أُنشئت — لا نمنع الانتقال بسببها وحدها.
  if (debtor) {
    const alreadyMoved =
      debtor.case_status === 'closed'
      || debtor.case_status === 'payment_in_progress'
      || (debtor.current_task_id != null && debtor.current_task_id !== task.id)
      || (
        debtor.current_task_id == null
        && debtor.last_task_id === task.id
      )
    if (alreadyMoved) {
      // إن كانت الأتعاب ما زالت معلّقة والمهمة التالية موجودة فعلياً — أكمل الاحتساب فقط
      if (
        awaitingFinalization
        && debtor.current_task_id
        && debtor.current_task_id !== task.id
      ) {
        const finalizeResult = await finalizeTaskApproval(supabase, task.id, userId, {
          task_status: (task as any).task_status,
          fee_status: (task as any).fee_status,
          assigned_to: (task as any).assigned_to ?? null,
        })
        if (!finalizeResult.ok) {
          return { ok: false, error: finalizeResult.error ?? 'فشل اعتماد الأتعاب بعد المهمة التالية' }
        }
        return { ok: true }
      }
      return { ok: false, error: 'تم تنفيذ الإجراء اللاحق لهذه المهمة مسبقاً' }
    }
  }

  const branchId = task.branch_id ?? debtor?.branch_id ?? null
  const gpsKeys = ((gpsRes.data ?? []) as { field_key: string }[]).map(f => f.field_key)
  const newGps = extractGpsFromCompletion(completionData, gpsKeys)
  const hasExistingGps = debtor?.latitude != null && debtor?.longitude != null
  const shouldSaveGps = Boolean(newGps && debtorId && (!hasExistingGps || updateGps))

  function gpsPatch(): Record<string, unknown> {
    if (!shouldSaveGps || !newGps) return {}
    return {
      latitude: newGps.lat,
      longitude: newGps.lng,
      location_captured_at: new Date().toISOString(),
    }
  }

  if (action === 'close') {
    const closedAt = new Date().toISOString()
    const closeBase = {
      case_status: 'closed',
      closed_at: closedAt,
      current_task_id: null,
      last_task_id: task.id,
      ...gpsPatch(),
    }
    const closePayloads: Record<string, unknown>[] = [
      closeBase,
      { case_status: 'closed', closed_at: closedAt, current_task_id: null, ...gpsPatch() },
      { status: 'closed', closed_at: closedAt, current_task_id: null, last_task_id: task.id, ...gpsPatch() },
      { status: 'closed', closed_at: closedAt, current_task_id: null, ...gpsPatch() },
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

    if (awaitingFinalization) {
      const finalizeResult = await finalizeTaskApproval(supabase, task.id, userId, {
        task_status: (task as any).task_status,
        fee_status: (task as any).fee_status,
        assigned_to: (task as any).assigned_to ?? null,
      })
      if (!finalizeResult.ok) {
        await supabase.from('debtors').update({
          case_status: debtor?.case_status ?? 'active',
          closed_at: null,
          current_task_id: debtor?.current_task_id ?? task.id,
          last_task_id: debtor?.last_task_id ?? null,
        } as any).eq('id', task.debtor_id)
        return { ok: false, error: finalizeResult.error ?? 'فشل الاعتماد النهائي واحتساب الأتعاب' }
      }
    }

    return { ok: true }
  }

  if (!nextTaskDefId) {
    return { ok: false, error: 'يجب اختيار المهمة اللاحقة' }
  }

  const nextDef = nextDefRes.data as {
    id: string
    label: string
    fee_amount: number | null
    task_type: string | null
    case_type: string | null
  } | null

  const debtorCase = debtor?.case_type === 'criminal' ? 'criminal' : 'civil'
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

  const hearingDate =
    (task as any).task_type === 'file_lawsuit'
      ? extractHearingDateFromCompletion(completionData)
      : null

  const { error: linkErr } = await supabase
    .from('debtors')
    .update({
      current_task_id: newTask.id,
      last_task_id: task.id,
      case_status: 'active',
      ...gpsPatch(),
      ...(hearingDate ? { first_hearing_date: hearingDate } : {}),
    } as any)
    .eq('id', task.debtor_id)

  if (linkErr) {
    await supabase.from('tasks').delete().eq('id', newTask.id)
    return { ok: false, error: linkErr.message }
  }

  if (nextDef && isPleadingDefinition(nextDef)) {
    await ensurePleadingNotificationTwin(
      supabase,
      {
        id: newTask.id,
        debtor_id: task.debtor_id as string,
        branch_id: branchId,
        due_date: hearingDate,
      },
      {
        caseType: debtorCase,
        hearingDate,
        createdBy: userId,
      },
    ).catch((e) => console.warn('[applyTaskTransition:twin]', e))
  }

  // الاعتماد النهائي واحتساب الأتعاب — فقط بعد نجاح إنشاء المهمة التالية وربطها
  if (awaitingFinalization) {
    const finalizeResult = await finalizeTaskApproval(supabase, task.id, userId, {
      task_status: (task as any).task_status,
      fee_status: (task as any).fee_status,
      assigned_to: (task as any).assigned_to ?? null,
    })
    if (!finalizeResult.ok) {
      await supabase
        .from('debtors')
        .update({
          current_task_id: debtor?.current_task_id ?? task.id,
          last_task_id: debtor?.last_task_id ?? null,
          case_status: debtor?.case_status ?? 'active',
        } as any)
        .eq('id', task.debtor_id)
      await supabase.from('tasks').delete().eq('id', newTask.id)
      await endPleadingNotificationDual(supabase, newTask.id).catch(() => {})
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

export async function unassignTasksViaApi(
  taskIds: string[],
  reason?: string | null,
): Promise<{ ok: boolean; error: string | null; updatedIds?: string[] }> {
  const res = await fetch('/api/admin/unassign-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskIds, reason: reason ?? null }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.ok) {
    return { ok: false, error: data.error ?? 'فشل إلغاء التكليف' }
  }
  return { ok: true, error: null, updatedIds: data.updatedIds }
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
