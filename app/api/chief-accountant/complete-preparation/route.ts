import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, isChiefAccountant } from '@/lib/permissions'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import { logActivity } from '@/lib/activity-log'
import { resolveTaskDefinitionId } from '@/lib/task-definition-expenses'
import { isAssignedToChief } from '@/lib/chief-accountant-access'

const MAX_IDS = 500

type FailRow = { id: string; name: string; reason: string }

function parseDebtorIds(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { debtorIds?: unknown }).debtorIds
  if (!Array.isArray(raw)) return null
  const ids = [...new Set(raw.map(v => String(v ?? '').trim()).filter(Boolean))]
  return ids.length ? ids.slice(0, MAX_IDS) : null
}

/**
 * إتمام تجهيز الملفات: status=ready + إنشاء مهمة إقامة دعوى (file_lawsuit) waiting_assignment.
 * المحاسب الرئيسي فقط — وفقط للمدينين المعيَّنين له.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!isChiefAccountant(auth.profile?.role)) return apiForbiddenResponse()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const debtorIds = parseDebtorIds(body)
  if (!debtorIds) return safeClientError('معرّفات المدينين مطلوبة', 400)

  const admin = createAdminClient()
  const userId = auth.user!.id

  const { data: targets, error: targetsErr } = await admin
    .from('debtors')
    .select('id, full_name, branch_id, case_type, current_task_id, file_preparation_status, assigned_chief_accountant_id')
    .in('id', debtorIds)

  if (targetsErr) {
    if (String(targetsErr.message ?? '').includes('file_preparation_status')
      || String(targetsErr.message ?? '').includes('assigned_chief_accountant')) {
      return safeClientError('أعمدة تجهيز الملفات غير مفعّلة بعد — طبّق الهجرة أولاً', 400)
    }
    return apiServerError('complete-preparation:targets', targetsErr)
  }

  if (!targets?.length) return safeClientError('لم يُعثر على المدينين المحددين', 404)

  const failed: FailRow[] = []
  const completedIds: string[] = []
  const createdTaskIds: string[] = []

  for (const d of targets) {
    const name = d.full_name?.trim() || d.id
    if (!isAssignedToChief(userId, d)) {
      failed.push({ id: d.id, name, reason: 'المدين غير معيَّن لك' })
      continue
    }
    if (d.file_preparation_status !== 'preparing') {
      failed.push({ id: d.id, name, reason: 'المدين ليس قيد التجهيز' })
      continue
    }
    if (!d.branch_id) {
      failed.push({ id: d.id, name, reason: 'المدين بلا فرع' })
      continue
    }

    const defId = await resolveTaskDefinitionId(admin, {
      taskType: 'file_lawsuit',
      branchId: d.branch_id,
    })
    if (!defId) {
      failed.push({ id: d.id, name, reason: 'لا يوجد تعريف مهمة «إقامة دعوى» لهذا الفرع' })
      continue
    }

    const { data: def, error: defErr } = await admin
      .from('task_definitions')
      .select('id, task_type, fee_amount, case_type')
      .eq('id', defId)
      .maybeSingle()
    if (defErr || !def) {
      failed.push({ id: d.id, name, reason: 'تعذر تحميل تعريف مهمة إقامة الدعوى' })
      continue
    }

    // إن وُجدت مهمة إقامة دعوى حالية بانتظار التكليف — أعد استخدامها
    let taskId: string | null = null
    if (d.current_task_id) {
      const { data: cur } = await admin
        .from('tasks')
        .select('id, task_type, task_status, task_definition_id')
        .eq('id', d.current_task_id)
        .maybeSingle()
      if (
        cur
        && (cur.task_type === 'file_lawsuit' || cur.task_definition_id === def.id)
        && ['waiting_assignment', 'pending_assignment', 'draft', 'new'].includes(String(cur.task_status ?? ''))
      ) {
        taskId = cur.id
        await admin
          .from('tasks')
          .update({
            task_definition_id: def.id,
            task_type: 'file_lawsuit',
            task_status: 'waiting_assignment',
            assigned_to: null,
            reward_amount: def.fee_amount ?? 0,
            branch_id: d.branch_id,
          })
          .eq('id', cur.id)
      }
    }

    if (!taskId) {
      const { data: newTask, error: taskErr } = await admin
        .from('tasks')
        .insert({
          debtor_id: d.id,
          task_definition_id: def.id,
          task_type: 'file_lawsuit',
          task_status: 'waiting_assignment',
          assigned_to: null,
          reward_amount: def.fee_amount ?? 0,
          branch_id: d.branch_id,
          created_by: userId,
        })
        .select('id')
        .single()
      if (taskErr || !newTask) {
        failed.push({
          id: d.id,
          name,
          reason: taskErr?.message || 'فشل إنشاء مهمة إقامة الدعوى',
        })
        continue
      }
      taskId = newTask.id
      createdTaskIds.push(newTask.id)
    }

    const { error: updErr } = await admin
      .from('debtors')
      .update({
        file_preparation_status: 'ready',
        current_task_id: taskId,
      })
      .eq('id', d.id)
      .eq('assigned_chief_accountant_id', userId)

    if (updErr) {
      failed.push({ id: d.id, name, reason: updErr.message || 'فشل تحديث حالة التجهيز' })
      continue
    }

    completedIds.push(d.id)
  }

  if (completedIds.length) {
    await logActivity({
      action: 'complete_file_preparation',
      entity_type: 'debtor',
      description: `إتمام تجهيز ملفات ${completedIds.length} مدين وإنشاء مهام إقامة دعوى`,
      metadata: {
        debtorIds: completedIds,
        createdTaskIds,
        failedCount: failed.length,
      },
    }, auth.supabase)
  }

  if (completedIds.length === 0) {
    const sample = failed[0]?.reason ?? 'تعذر إتمام التجهيز'
    return NextResponse.json(
      { ok: false, error: sample, updated: 0, failed },
      { status: 400 },
    )
  }

  return NextResponse.json({
    ok: true,
    updated: completedIds.length,
    updatedIds: completedIds,
    createdTaskIds,
    failed,
  })
}
