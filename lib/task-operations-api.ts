import { rejectTaskExpenses } from '@/lib/expense-wallet'
import { extractGpsFromCompletion } from '@/lib/task-approval'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function rejectTaskCompletion(
  supabase: SupabaseClient,
  taskId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = reason.trim()
  if (!trimmed) return { ok: false, error: 'يجب إدخال سبب الرفض' }

  // مصدر الحقيقة: needs_revision (يظهر في تبويب مرفوضة والعدادات)
  // rejected احتياطي فقط إن لم يدعم الـ enum القيمة needs_revision
  const payloads = [
    { task_status: 'needs_revision', admin_notes: trimmed },
    { task_status: 'rejected', admin_notes: trimmed },
  ]

  let lastErr: { message?: string } | null = null
  for (const payload of payloads) {
    const { error: err } = await supabase.from('tasks').update(payload as any).eq('id', taskId)
    if (!err) {
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
      id, debtor_id, branch_id, task_type, task_definition_id, completion_data,
      task_definitions ( label, fee_amount )
    `)
    .eq('id', taskId)
    .single()

  if (taskErr || !task) {
    return { ok: false, error: taskErr?.message ?? 'المهمة غير موجودة' }
  }

  let debtor: {
    id: string
    full_name: string
    branch_id: string | null
    latitude: number | null
    longitude: number | null
  } | null = null

  if (task.debtor_id) {
    const { data: debtorRow, error: debtorErr } = await supabase
      .from('debtors')
      .select('id, full_name, branch_id, latitude, longitude')
      .eq('id', task.debtor_id)
      .maybeSingle()

    if (debtorErr) {
      return { ok: false, error: debtorErr.message }
    }
    debtor = debtorRow
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
    return { ok: false, error: linkErr.message }
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
