import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMutationStaff } from '@/lib/api-auth'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { canManageSettings, apiForbiddenResponse } from '@/lib/permissions'
import { pickAllowedFields } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'

const ALLOWED = new Set([
  'task_definitions',
  'task_required_fields',
  'task_definition_expenses',
  'courts',
  'execution_departments',
  'expense_types',
  'branch_lists',
])

const COLUMNS: Record<string, readonly string[]> = {
  courts: ['name', 'branch_id', 'is_active'],
  execution_departments: ['name', 'court_id', 'branch_id', 'is_active'],
  expense_types: [
    'name', 'default_amount', 'requires_attachment', 'requires_note', 'requires_gps',
    'branch_id', 'is_active',
  ],
  task_definitions: ['label', 'fee_amount', 'is_active', 'sort_order', 'branch_id', 'task_type'],
  task_required_fields: [
    'task_definition_id', 'field_key', 'field_type', 'field_label', 'is_required', 'sort_order',
  ],
  task_definition_expenses: [
    'task_definition_id', 'name', 'max_amount', 'sort_order',
  ],
  branch_lists: ['name', 'branch_id', 'is_active'],
}

type Body = {
  action?: string
  table?: string
  id?: string
  branchId?: string
  row?: Record<string, unknown>
  definitionId?: string
  fields?: Record<string, unknown>[]
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationStaff()
  if (auth.error) return auth.error
  if (!canManageSettings(auth.profile?.role)) return apiForbiddenResponse()

  let body: Body
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const admin = createAdminClient()
  const action = String(body.action ?? '')

  // Dedicated replace for required fields (UI).
  if (action === 'replace_required_fields') {
    const definitionId = String(body.definitionId ?? '').trim()
    const branchId = String(body.branchId ?? '').trim()
    if (!definitionId) return safeClientError('معرّف التعريف مطلوب', 400)

    const { data: def } = await admin.from('task_definitions').select('branch_id').eq('id', definitionId).maybeSingle()
    const defBranch = def?.branch_id ?? branchId
    if (!defBranch || !canStaffWriteBranch(auth.profile, defBranch)) return apiForbiddenResponse()

    const fields = Array.isArray(body.fields) ? body.fields : []
    const cleaned = fields.map((f, i) => {
      const row = pickAllowedFields(f, COLUMNS.task_required_fields)
      return {
        task_definition_id: definitionId,
        field_key: String(row.field_key ?? `field_${i}`).slice(0, 80),
        field_type: String(row.field_type ?? 'text').slice(0, 40),
        field_label: String(row.field_label ?? '').slice(0, 200),
        is_required: Boolean(row.is_required ?? true),
        sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : i,
      }
    })

    const { error: delErr } = await admin.from('task_required_fields').delete().eq('task_definition_id', definitionId)
    if (delErr) return apiServerError('branch-settings:replace-del', delErr, 'فشل تحديث الحقول')

    if (cleaned.length > 0) {
      const { error: insErr } = await admin.from('task_required_fields').insert(cleaned)
      if (insErr) return apiServerError('branch-settings:replace-ins', insErr, 'فشل تحديث الحقول')
    }
    return NextResponse.json({ ok: true })
  }

  const table = String(body.table ?? '')
  if (!ALLOWED.has(table)) {
    return safeClientError('جدول غير مسموح', 400)
  }

  const allowedCols = COLUMNS[table]
  if (!allowedCols) return safeClientError('جدول غير مسموح', 400)

  const branchId = String(body.branchId ?? body.row?.branch_id ?? '').trim()

  if (table === 'task_required_fields' || table === 'task_definition_expenses') {
    const defId = String(body.row?.task_definition_id ?? '').trim()
    if (defId) {
      const { data: def } = await admin.from('task_definitions').select('branch_id').eq('id', defId).maybeSingle()
      if (!def?.branch_id || !canStaffWriteBranch(auth.profile, def.branch_id)) return apiForbiddenResponse()
    } else if (action === 'update' || action === 'delete') {
      const id = String(body.id ?? '').trim()
      if (!id) return safeClientError('معرّف الصف مطلوب', 400)
      const { data: existing } = await admin.from(table).select('task_definition_id').eq('id', id).maybeSingle()
      const parentId = (existing as { task_definition_id?: string } | null)?.task_definition_id
      if (parentId) {
        const { data: def } = await admin.from('task_definitions').select('branch_id').eq('id', parentId).maybeSingle()
        if (!def?.branch_id || !canStaffWriteBranch(auth.profile, def.branch_id)) return apiForbiddenResponse()
      }
    }
  } else if (branchId) {
    if (!canStaffWriteBranch(auth.profile, branchId)) return apiForbiddenResponse()
  } else if (action === 'update' || action === 'delete') {
    const id = String(body.id ?? '').trim()
    if (id && (table === 'courts' || table === 'execution_departments' || table === 'expense_types' || table === 'task_definitions' || table === 'branch_lists')) {
      const { data: existing } = await admin.from(table).select('branch_id').eq('id', id).maybeSingle()
      const existingBranch = (existing as { branch_id?: string } | null)?.branch_id
      if (existingBranch && !canStaffWriteBranch(auth.profile, existingBranch)) return apiForbiddenResponse()
    }
  }

  if (action === 'insert') {
    const row = pickAllowedFields(body.row, allowedCols)
    if (Object.keys(row).length === 0) return safeClientError('لا توجد حقول صالحة', 400)
    const { data, error } = await admin.from(table).insert(row).select('*').single()
    if (error) return apiServerError('branch-settings:insert', error, 'فشل الحفظ')
    return NextResponse.json({ ok: true, row: data })
  }

  if (action === 'update') {
    const id = String(body.id ?? '').trim()
    if (!id) return safeClientError('معرّف الصف مطلوب', 400)
    const row = pickAllowedFields(body.row, allowedCols)
    if (Object.keys(row).length === 0) return safeClientError('لا توجد حقول صالحة', 400)
    const { data, error } = await admin.from(table).update(row).eq('id', id).select('*').single()
    if (error) return apiServerError('branch-settings:update', error, 'فشل الحفظ')
    return NextResponse.json({ ok: true, row: data })
  }

  if (action === 'delete') {
    const id = String(body.id ?? '').trim()
    if (!id) return safeClientError('معرّف الصف مطلوب', 400)
    const { error } = await admin.from(table).delete().eq('id', id)
    if (error) return apiServerError('branch-settings:delete', error, 'فشل الحذف')
    return NextResponse.json({ ok: true })
  }

  return safeClientError('إجراء غير معروف', 400)
}
