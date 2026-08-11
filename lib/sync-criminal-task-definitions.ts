import type { SupabaseClient } from '@supabase/supabase-js'

/** تطابق التسميات الأصلية مع task_type في enum */
const KNOWN_CRIMINAL_TASK_TYPES: Record<string, string> = {
  'تقديم طلب دعوى جزائية': 'criminal_lawsuit_request',
  'تدوين أقوال في مركز الشرطة': 'police_station_statement',
  'تدوين أقوال في المحكمة': 'court_statement',
  'تدوين أقوال الشهود': 'witness_statement',
}

/**
 * ترتيب تخصيص task_type عند وجود قيد (task_type, branch_id) فريد.
 * نفضّل الأنواع الجزائية ثم الأقل اعتماداً على منطق خاص، ونتجنب تكرار custom.
 */
const TASK_TYPE_ALLOCATION_ORDER: string[] = [
  'criminal_lawsuit_request',
  'police_station_statement',
  'court_statement',
  'witness_statement',
  'custom',
  'department_correspondence',
  'newspaper_publication',
  'salary_seizure',
  'first_registration',
  'file_closure',
  'find_missing_address',
  'find_address',
  'arrest_warrant_broadcast',
  'imprisonment_broadcast',
  'imprisonment_in_absentia',
  'forced_appearance',
  'arrest_warrant',
  'inspection',
  'open_file',
  'summons',
  'decision_ratification',
  'negotiations',
  'settlement',
  'notification',
  'pleading',
  'file_lawsuit',
]

export const TASK_DEF_MULTI_CUSTOM_SQL_HINT =
  'قاعدة البيانات تمنع أكثر من مهمة إضافية واحدة لكل فرع. نفّذ أحدث نسخة من supabase/scripts/apply-task-def-allow-multiple-custom.sql في Supabase SQL Editor ثم أعد فتح نافذة الإسناد.'

function isTaskTypeUniqError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('task_def_type_branch_uniq')
    || (m.includes('task_type') && (m.includes('duplicate') || m.includes('unique') || m.includes('23505')))
    || (m.includes('duplicate key') && m.includes('task_type'))
  )
}

function normLabel(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

function slugFieldKey(label: string, index: number): string {
  const base = label
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9_]/g, '')
    .slice(0, 40)
  return base || `field_${index + 1}`
}

type CriminalDef = {
  id: string
  branch_id: string
  label: string
  fee_amount: number | null
  actual_fee_amount?: number | null
  sort_order: number | null
  is_active: boolean | null
}

type TaskDefRow = {
  id: string
  label: string | null
  is_active: boolean | null
  fee_amount: number | null
  sort_order: number | null
  task_type: string | null
}

/**
 * يزامن تعريفات المهام الجزائية (criminal_case_task_definitions)
 * إلى task_definitions حتى تظهر في إسناد المهام للمدينين.
 *
 * عند بقاء قيد task_def_type_branch_uniq يخصّص أنواعاً غير مستخدمة في الفرع
 * بدل الاعتماد على عدة صفوف task_type=custom.
 */
export async function syncCriminalDefsToTaskDefinitions(
  admin: SupabaseClient,
  branchId: string,
): Promise<{ synced: number; created: number; updated: number; errors?: string[] }> {
  const { data: criminalDefs, error: cErr } = await admin
    .from('criminal_case_task_definitions')
    .select('id, branch_id, label, fee_amount, actual_fee_amount, sort_order, is_active')
    .eq('branch_id', branchId)
    .order('sort_order')

  if (cErr) {
    // الجدول غير موجود — لا شيء للمزامنة
    if (
      cErr.message?.includes('criminal_case_task_definitions')
      || cErr.code === '42P01'
      || cErr.code === 'PGRST205'
    ) {
      return { synced: 0, created: 0, updated: 0 }
    }
    throw new Error(cErr.message)
  }

  const list = (criminalDefs ?? []) as CriminalDef[]
  if (!list.length) return { synced: 0, created: 0, updated: 0 }

  const { data: existing, error: eErr } = await admin
    .from('task_definitions')
    .select('id, label, is_active, fee_amount, sort_order, task_type')
    .eq('branch_id', branchId)
    .eq('case_type', 'criminal')

  if (eErr) throw new Error(eErr.message)

  // كل الأنواع المستخدمة في الفرع (مدني + جزائي) بسبب القيد الفريد على (task_type, branch_id)
  const { data: allBranchDefs, error: allErr } = await admin
    .from('task_definitions')
    .select('task_type')
    .eq('branch_id', branchId)

  if (allErr) throw new Error(allErr.message)

  const usedTypes = new Set<string>()
  for (const row of allBranchDefs ?? []) {
    const t = (row as { task_type?: string | null }).task_type
    if (t) usedTypes.add(t)
  }

  const byLabel = new Map<string, TaskDefRow>()
  for (const row of (existing ?? []) as TaskDefRow[]) {
    byLabel.set(normLabel(row.label), row)
  }

  let created = 0
  let updated = 0
  const errors: string[] = []
  const criminalIds = list.map(d => d.id)

  const { data: reqFields } = await admin
    .from('criminal_case_required_fields')
    .select('task_definition_id, field_key, field_type, field_label, is_required, sort_order')
    .in('task_definition_id', criminalIds)

  const fieldsByCriminalId = new Map<string, Array<{
    field_key: string
    field_type: string
    field_label: string | null
    is_required: boolean
    sort_order: number
  }>>()
  for (const f of reqFields ?? []) {
    const cid = String((f as { task_definition_id: string }).task_definition_id)
    const prev = fieldsByCriminalId.get(cid) ?? []
    prev.push({
      field_key: String((f as { field_key: string }).field_key),
      field_type: String((f as { field_type?: string }).field_type ?? 'text'),
      field_label: (f as { field_label?: string | null }).field_label ?? null,
      is_required: Boolean((f as { is_required?: boolean }).is_required),
      sort_order: Number((f as { sort_order?: number }).sort_order) || 0,
    })
    fieldsByCriminalId.set(cid, prev)
  }

  for (const cdef of list) {
    try {
      const label = normLabel(cdef.label)
      if (!label) continue
      const fee = Number(cdef.actual_fee_amount ?? cdef.fee_amount ?? 0) || 0
      const sortOrder = Number(cdef.sort_order) || 0
      const isActive = cdef.is_active !== false
      const existingRow = byLabel.get(label)

      let taskDefId: string

      if (existingRow) {
        taskDefId = existingRow.id
        if (existingRow.task_type) usedTypes.add(existingRow.task_type)
        const patch: Record<string, unknown> = {}
        if (Boolean(existingRow.is_active) !== isActive) patch.is_active = isActive
        if (Number(existingRow.fee_amount) !== fee) patch.fee_amount = fee
        if (Number(existingRow.sort_order) !== sortOrder) patch.sort_order = sortOrder
        if (Object.keys(patch).length) {
          const { error } = await admin.from('task_definitions').update(patch).eq('id', taskDefId)
          if (error) throw new Error(error.message)
          updated += 1
        }
      } else {
        // بعد إسقاط القيد: عدة صفوف custom مسموحة. إن بقي القيد نجرّب أنواعاً بديلة.
        const known = KNOWN_CRIMINAL_TASK_TYPES[label]
        const candidates: string[] = []
        if (known && !usedTypes.has(known)) candidates.push(known)
        if (!candidates.includes('custom')) candidates.push('custom')
        for (const t of TASK_TYPE_ALLOCATION_ORDER) {
          if (!candidates.includes(t) && !usedTypes.has(t)) candidates.push(t)
        }

        let insertedId: string | null = null
        let usedTaskType: string | null = null
        let lastErr = ''

        for (const taskType of candidates) {
          const { data: inserted, error: insErr } = await admin
            .from('task_definitions')
            .insert({
              branch_id: branchId,
              label,
              fee_amount: fee,
              sort_order: sortOrder,
              is_active: isActive,
              case_type: 'criminal' as const,
              task_type: taskType,
            })
            .select('id')
            .single()

          if (!insErr && inserted?.id) {
            insertedId = inserted.id
            usedTaskType = taskType
            break
          }

          lastErr = insErr?.message ?? 'فشل إنشاء تعريف مهمة'
          if (!isTaskTypeUniqError(lastErr)) {
            throw new Error(lastErr)
          }
          // النوع محجوز — جرّب التالي
          usedTypes.add(taskType)
        }

        if (!insertedId || !usedTaskType) {
          throw new Error(`task_def_type_branch_uniq: ${TASK_DEF_MULTI_CUSTOM_SQL_HINT}${lastErr ? ` (${lastErr})` : ''}`)
        }

        taskDefId = insertedId
        usedTypes.add(usedTaskType)
        byLabel.set(label, {
          id: taskDefId,
          label,
          is_active: isActive,
          fee_amount: fee,
          sort_order: sortOrder,
          task_type: usedTaskType,
        })
        created += 1
      }

      const srcFields = fieldsByCriminalId.get(cdef.id) ?? []
      if (srcFields.length) {
        await admin.from('task_required_fields').delete().eq('task_definition_id', taskDefId)
        const payload = srcFields.map((f, i) => ({
          task_definition_id: taskDefId,
          field_key: f.field_key || slugFieldKey(f.field_label ?? '', i),
          field_type: f.field_type || 'text',
          field_label: f.field_label || f.field_key,
          is_required: f.is_required,
          sort_order: f.sort_order ?? i,
        }))
        const { error: fErr } = await admin.from('task_required_fields').insert(payload)
        if (fErr) console.warn('[sync-criminal-defs] fields:', label, fErr.message)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${cdef.label}: ${msg}`)
      console.warn('[sync-criminal-defs]', cdef.label, msg)
    }
  }

  if (errors.length && created === 0 && updated === 0) {
    throw new Error(errors[0])
  }

  return { synced: list.length, created, updated, errors }
}
