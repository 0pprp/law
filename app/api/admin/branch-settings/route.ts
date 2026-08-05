import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMutationStaff } from '@/lib/api-auth'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { canManageSettings, canManageTaskManagement, apiForbiddenResponse } from '@/lib/permissions'
import { pickAllowedFields } from '@/lib/storage-path'
import { apiServerError, safeClientError } from '@/lib/safe-api-error'
import {
  normalizeBranchListName,
  sanitizeBranchListDisplayName,
} from '@/lib/branch-list-normalize'
import { parseMoneyInput } from '@/lib/money-input'

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
  branch_lists: ['name', 'branch_id', 'is_active', 'normalized_name'],
}

type Body = {
  action?: string
  table?: string
  id?: string
  branchId?: string
  row?: Record<string, unknown>
  definitionId?: string
  definitionIds?: string[]
  fields?: Record<string, unknown>[] | string[]
  expenses?: { name?: string; max_amount?: string | number }[]
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationStaff()
  if (auth.error) return auth.error
  const canWriteSettings = canManageSettings(auth.profile?.role) || canManageTaskManagement(auth.profile?.role)
  if (!canWriteSettings) return apiForbiddenResponse()

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
      if (typeof f === 'string') {
        return {
          task_definition_id: definitionId,
          field_key: f.slice(0, 80),
          field_type: f.slice(0, 40),
          field_label: '',
          is_required: true,
          sort_order: i,
        }
      }
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

  /** استبدال صرفيات (+ حقول اختيارية) لتعريف مهمة أو أكثر — يتجاوز قيود RLS عبر admin */
  if (action === 'replace_definition_expenses') {
    const ids = [
      ...((Array.isArray(body.definitionIds) ? body.definitionIds : []) as unknown[]).map(String),
      String(body.definitionId ?? '').trim(),
    ].map(s => s.trim()).filter(Boolean)
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) return safeClientError('معرّف التعريف مطلوب', 400)

    const { data: defs, error: defsErr } = await admin
      .from('task_definitions')
      .select('id, branch_id')
      .in('id', uniqueIds)
    if (defsErr) return apiServerError('branch-settings:replace-exp-defs', defsErr, 'فشل قراءة التعريفات')
    if (!defs?.length) return safeClientError('التعريفات غير موجودة', 404)

    for (const def of defs) {
      if (!def.branch_id || !canStaffWriteBranch(auth.profile, def.branch_id)) return apiForbiddenResponse()
    }

    const rawExpenses = Array.isArray(body.expenses) ? body.expenses : []
    const cleanedExpenses = rawExpenses
      .map((e, idx) => {
        const name = String(e?.name ?? '').trim()
        const maxAmount = parseMoneyInput(e?.max_amount)
        if (!name || maxAmount <= 0) return null
        return { name: name.slice(0, 200), max_amount: maxAmount, sort_order: idx }
      })
      .filter((e): e is { name: string; max_amount: number; sort_order: number } => e != null)

    const replaceFields = body.fields !== undefined
    const rawFields = Array.isArray(body.fields) ? body.fields : []

    for (const def of defs) {
      const { error: delExpErr } = await admin
        .from('task_definition_expenses')
        .delete()
        .eq('task_definition_id', def.id)
      if (delExpErr) {
        return apiServerError('branch-settings:replace-exp-del', delExpErr, 'فشل تحديث الصرفيات')
      }

      if (cleanedExpenses.length) {
        const { error: insExpErr } = await admin.from('task_definition_expenses').insert(
          cleanedExpenses.map(e => ({
            task_definition_id: def.id,
            name: e.name,
            max_amount: e.max_amount,
            sort_order: e.sort_order,
          })),
        )
        if (insExpErr) {
          return apiServerError('branch-settings:replace-exp-ins', insExpErr, 'فشل حفظ الصرفيات')
        }
      }

      if (replaceFields) {
        const cleanedFields = rawFields.map((f, i) => {
          if (typeof f === 'string') {
            const key = f.trim().slice(0, 80)
            return {
              task_definition_id: def.id,
              field_key: key,
              field_type: key.slice(0, 40),
              is_required: true,
              sort_order: i,
            }
          }
          const row = pickAllowedFields(f as Record<string, unknown>, COLUMNS.task_required_fields)
          return {
            task_definition_id: def.id,
            field_key: String(row.field_key ?? `field_${i}`).slice(0, 80),
            field_type: String(row.field_type ?? 'text').slice(0, 40),
            field_label: String(row.field_label ?? '').slice(0, 200) || null,
            is_required: Boolean(row.is_required ?? true),
            sort_order: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : i,
          }
        }).filter(f => f.field_key)

        const { error: delFieldErr } = await admin
          .from('task_required_fields')
          .delete()
          .eq('task_definition_id', def.id)
        if (delFieldErr) {
          return apiServerError('branch-settings:replace-fields-del', delFieldErr, 'فشل تحديث الحقول')
        }
        if (cleanedFields.length) {
          const { error: insFieldErr } = await admin.from('task_required_fields').insert(cleanedFields)
          if (insFieldErr) {
            return apiServerError('branch-settings:replace-fields-ins', insFieldErr, 'فشل حفظ الحقول')
          }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      definitionCount: defs.length,
      expenseCount: cleanedExpenses.length,
    })
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
    let row = pickAllowedFields(body.row, allowedCols)
    if (table === 'branch_lists') {
      const name = sanitizeBranchListDisplayName(row.name)
      const key = normalizeBranchListName(name)
      if (!name || !key) return safeClientError('اسم القائمة غير صالح', 400)
      const { data: conflict } = await admin
        .from('branch_lists')
        .select('id, name')
        .eq('branch_id', String(row.branch_id ?? branchId))
        .eq('normalized_name', key)
        .maybeSingle()
      // إن لم يوجد العمود بعد، نقارن في الذاكرة
      if (!conflict) {
        const { data: all } = await admin
          .from('branch_lists')
          .select('id, name')
          .eq('branch_id', String(row.branch_id ?? branchId))
        const hit = (all ?? []).find(l => normalizeBranchListName(l.name) === key)
        if (hit) {
          return safeClientError(`هذه القائمة موجودة مسبقاً باسم: ${hit.name}`, 409)
        }
      } else {
        return safeClientError(`هذه القائمة موجودة مسبقاً باسم: ${conflict.name}`, 409)
      }
      row = { ...row, name, normalized_name: key }
    }
    if (Object.keys(row).length === 0) return safeClientError('لا توجد حقول صالحة', 400)
    const { data, error } = await admin.from(table).insert(row).select('*').single()
    if (error) {
      if (table === 'branch_lists' && String(error.message ?? '').includes('normalized_name')) {
        const { normalized_name: _n, ...without } = row
        const retry = await admin.from(table).insert(without).select('*').single()
        if (retry.error) return apiServerError('branch-settings:insert', retry.error, 'فشل الحفظ')
        return NextResponse.json({ ok: true, row: retry.data })
      }
      return apiServerError('branch-settings:insert', error, 'فشل الحفظ')
    }
    return NextResponse.json({ ok: true, row: data })
  }

  if (action === 'update') {
    const id = String(body.id ?? '').trim()
    if (!id) return safeClientError('معرّف الصف مطلوب', 400)
    let row = pickAllowedFields(body.row, allowedCols)
    if (table === 'branch_lists' && row.name != null) {
      const name = sanitizeBranchListDisplayName(row.name)
      const key = normalizeBranchListName(name)
      if (!name || !key) return safeClientError('اسم القائمة غير صالح', 400)
      const branchForList = String(row.branch_id ?? branchId)
      const { data: existing } = await admin.from('branch_lists').select('branch_id').eq('id', id).maybeSingle()
      const bId = existing?.branch_id ?? branchForList
      const { data: all } = await admin.from('branch_lists').select('id, name, normalized_name').eq('branch_id', bId)
      const hit = (all ?? []).find(
        l => l.id !== id && (
          l.normalized_name === key || normalizeBranchListName(l.name) === key
        ),
      )
      if (hit) {
        return NextResponse.json({
          error: `يوجد اسم مطابق. هل تريد دمج القائمتين؟`,
          conflict: { id: hit.id, name: hit.name },
          code: 'BRANCH_LIST_MERGE_REQUIRED',
        }, { status: 409 })
      }
      row = { ...row, name, normalized_name: key }
    }
    if (Object.keys(row).length === 0) return safeClientError('لا توجد حقول صالحة', 400)
    const { data, error } = await admin.from(table).update(row).eq('id', id).select('*').single()
    if (error) {
      if (table === 'branch_lists' && String(error.message ?? '').includes('normalized_name')) {
        const { normalized_name: _n, ...without } = row
        const retry = await admin.from(table).update(without).eq('id', id).select('*').single()
        if (retry.error) return apiServerError('branch-settings:update', retry.error, 'فشل الحفظ')
        return NextResponse.json({ ok: true, row: retry.data })
      }
      return apiServerError('branch-settings:update', error, 'فشل الحفظ')
    }
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
