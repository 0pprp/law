import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { canManageTaskManagement, apiForbiddenResponse, isAdmin } from '@/lib/permissions'
import { filterSelectableBranches } from '@/lib/branch-constants'
import { criminalTaskDefColumns, stripActualFeeAmount } from '@/lib/criminal-task-def-columns'
import { REQUIRED_FIELD_LABELS, type RequiredField } from '@/lib/types'

type ExpenseLine = { name: string; max_amount: number }

type DynFieldInput = {
  field_label: string
  field_type: string
  is_required?: boolean
}

type FieldRow = {
  field_key: string
  field_type: string
  field_label: string
  is_required: boolean
  sort_order: number
}

function normalizeFields(raw: unknown[]): FieldRow[] {
  const out: FieldRow[] = []
  raw.forEach((item, idx) => {
    if (typeof item === 'string') {
      const key = item.trim()
      if (!key) return
      out.push({
        field_key: key,
        field_type: key,
        field_label: REQUIRED_FIELD_LABELS[key as RequiredField] ?? key,
        is_required: true,
        sort_order: out.length,
      })
      return
    }
    if (!item || typeof item !== 'object') return
    const f = item as DynFieldInput
    const label = String(f.field_label ?? '').trim()
    if (!label) return
    const type = String(f.field_type ?? 'text').trim() || 'text'
    out.push({
      field_key: `field_${idx}_${type}`,
      field_type: type,
      field_label: label,
      is_required: f.is_required !== false,
      sort_order: out.length,
    })
  })
  return out
}

async function requireAdmin() {
  const auth = await requireStaffProfile()
  if (auth.error) return { error: auth.error }
  if (!canManageTaskManagement(auth.profile?.role)) return { error: apiForbiddenResponse() }
  return { auth }
}

/** قائمة تعريفات المهام الجزائية — actual_fee_amount للمدير فقط */
export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const adminUser = isAdmin(auth.profile?.role)
  const url = new URL(request.url)
  const branchId = url.searchParams.get('branchId')?.trim() || null
  const activeOnly = url.searchParams.get('activeOnly') !== '0'

  const admin = createAdminClient()
  let q = admin
    .from('criminal_case_task_definitions')
    .select(criminalTaskDefColumns(adminUser))
    .order('sort_order')

  if (activeOnly) q = q.eq('is_active', true)
  if (branchId) q = q.eq('branch_id', branchId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  return NextResponse.json({
    definitions: adminUser ? rows : rows.map(stripActualFeeAmount),
  })
}

/** إنشاء مهمة جزائية لفرع واحد أو لكل الفروع المعتمدة */
export async function POST(request: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const label = String(body.label ?? '').trim()
  // fee_amount يبقى 0 دائماً — لا يُلمس من الواجهة
  const actualFeeAmount = Number(body.actual_fee_amount) || 0
  const branchId = body.branchId ? String(body.branchId) : null
  const applyAll = Boolean(body.applyAllBranches)
  const fields = Array.isArray(body.fields) ? normalizeFields(body.fields) : []
  const expenses = Array.isArray(body.expenses) ? (body.expenses as ExpenseLine[]) : []

  if (!label) return NextResponse.json({ error: 'اسم المهمة مطلوب' }, { status: 400 })

  const admin = createAdminClient()
  let targetBranchIds: string[] = []

  if (applyAll) {
    const { data: branches, error } = await admin.from('branches').select('id, name').eq('is_active', true)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    targetBranchIds = filterSelectableBranches(branches ?? []).map(b => b.id)
    console.log('[task-management/criminal] creating for', targetBranchIds.length, 'branches')
  } else if (branchId) {
    targetBranchIds = [branchId]
    console.log('[task-management/criminal] creating for 1 branch', branchId)
  } else {
    return NextResponse.json({ error: 'الفرع مطلوب' }, { status: 400 })
  }

  if (!targetBranchIds.length) {
    return NextResponse.json({ error: 'لا توجد فروع لإنشاء المهمة عليها' }, { status: 400 })
  }

  const createdIds: string[] = []
  const failures: { branchId: string; error: string }[] = []

  for (const bid of targetBranchIds) {
    const { data: def, error: defErr } = await admin
      .from('criminal_case_task_definitions')
      .insert({
        branch_id: bid,
        label,
        fee_amount: 0,
        actual_fee_amount: actualFeeAmount,
        sort_order: 0,
        is_active: true,
      })
      .select('id')
      .single()

    if (defErr || !def) {
      failures.push({ branchId: bid, error: defErr?.message ?? 'فشل الإنشاء' })
      continue
    }

    const defId = String(def.id)
    createdIds.push(defId)

    if (fields.length) {
      await admin.from('criminal_case_required_fields').insert(
        fields.map(f => ({
          task_definition_id: defId,
          field_key: f.field_key,
          field_type: f.field_type,
          field_label: f.field_label,
          is_required: f.is_required,
          sort_order: f.sort_order,
        })),
      )
    }

    const validExp = expenses.filter(e => e.name?.trim() && Number(e.max_amount) > 0)
    if (validExp.length) {
      await admin.from('criminal_case_task_expense_limits').insert(
        validExp.map((e, idx) => ({
          task_definition_id: defId,
          name: e.name.trim(),
          max_amount: Number(e.max_amount),
          sort_order: idx,
        })),
      )
    }
  }

  return NextResponse.json({
    ok: true,
    createdCount: createdIds.length,
    createdIds,
    failures,
  })
}

/** تعديل سجل واحد + استبدال الحقول والصرفيات */
export async function PATCH(request: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const id = String(body.id ?? '').trim()
  if (!id) return NextResponse.json({ error: 'معرّف المهمة مطلوب' }, { status: 400 })

  const label = String(body.label ?? '').trim()
  const fields = Array.isArray(body.fields) ? normalizeFields(body.fields) : []
  const expenses = Array.isArray(body.expenses) ? (body.expenses as ExpenseLine[]) : []
  const isActive = body.is_active === undefined ? undefined : Boolean(body.is_active)

  const admin = createAdminClient()

  const patch: Record<string, unknown> = {}
  if (label) patch.label = label
  // fee_amount لا يُلمس أبداً — يبقى 0
  if (body.actual_fee_amount !== undefined) {
    patch.actual_fee_amount = Number(body.actual_fee_amount) || 0
  }
  if (isActive !== undefined) patch.is_active = isActive

  if (Object.keys(patch).length) {
    const { error } = await admin.from('criminal_case_task_definitions').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (body.fields !== undefined) {
    await admin.from('criminal_case_required_fields').delete().eq('task_definition_id', id)
    if (fields.length) {
      const { error } = await admin.from('criminal_case_required_fields').insert(
        fields.map(f => ({
          task_definition_id: id,
          field_key: f.field_key,
          field_type: f.field_type,
          field_label: f.field_label,
          is_required: f.is_required,
          sort_order: f.sort_order,
        })),
      )
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  if (body.expenses !== undefined) {
    await admin.from('criminal_case_task_expense_limits').delete().eq('task_definition_id', id)
    const validExp = expenses.filter(e => e.name?.trim() && Number(e.max_amount) > 0)
    if (validExp.length) {
      const { error } = await admin.from('criminal_case_task_expense_limits').insert(
        validExp.map((e, idx) => ({
          task_definition_id: id,
          name: e.name.trim(),
          max_amount: Number(e.max_amount),
          sort_order: idx,
        })),
      )
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

/** إيقاف (أرشفة) — لا حذف فعلي تماشياً مع سياسات RLS */
export async function DELETE(request: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  const id = new URL(request.url).searchParams.get('id')?.trim()
  if (!id) return NextResponse.json({ error: 'معرّف المهمة مطلوب' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('criminal_case_task_definitions')
    .update({ is_active: false })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
