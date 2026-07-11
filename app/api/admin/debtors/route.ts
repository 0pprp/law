import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMutationStaff, requireStaffProfile } from '@/lib/api-auth'
import { canStaffReadBranch, canStaffWriteBranch } from '@/lib/staff-branch-access'
import { canAddDebtor } from '@/lib/permissions'
import { apiForbiddenResponse } from '@/lib/permissions'
import { isMainBranchName } from '@/lib/branch-constants'
import {
  findDuplicateReceiptInBranch,
  isReceiptNumberMissing,
  normalizeReceiptNumberInput,
  RECEIPT_NUMBER_DUP_BRANCH_ERROR,
  RECEIPT_NUMBER_EMPTY_ERROR,
} from '@/lib/receipt-number'
import { computeDebtorRequiredAmount, computeRemainingFromRequired } from '@/lib/debtor-balances'
import { logActivity } from '@/lib/activity-log'

const DEFAULT_COLS =
  'id, full_name, phone, id_number, receipt_type, receipt_number, required_amount, remaining_amount, created_at, case_status, branch_list_id, branch_list:branch_lists(name)'

export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const branchId = searchParams.get('branchId')?.trim() || null
  const listId = searchParams.get('listId')?.trim() || ''
  const search = searchParams.get('search')?.trim() || ''
  const offset = Math.max(0, Number(searchParams.get('offset') ?? 0) || 0)
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 50) || 50))
  const cols = searchParams.get('cols')?.trim() || DEFAULT_COLS

  if (!branchId) {
    return NextResponse.json({ error: 'معرّف الفرع مطلوب' }, { status: 400 })
  }
  if (!canStaffReadBranch(auth.profile, branchId)) {
    return apiForbiddenResponse()
  }

  const admin = createAdminClient()
  let q = admin
    .from('debtors')
    .select(cols, { count: 'exact' })
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (listId) q = q.eq('branch_list_id', listId)
  if (search) {
    const s = search.replace(/[%_,]/g, '')
    q = q.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,receipt_number.ilike.%${s}%`)
  }

  const { data, count, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ debtors: data ?? [], total: count ?? 0 })
}

export async function POST(request: NextRequest) {
  const auth = await requireMutationStaff()
  if (auth.error) return auth.error
  if (!canAddDebtor(auth.profile?.role)) return apiForbiddenResponse()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const branchId = String(body.branchId ?? '').trim()
  const taskDefinitionId = String(body.taskDefinitionId ?? '').trim()
  const fullName = String(body.full_name ?? '').trim()
  const receiptNumber = normalizeReceiptNumberInput(String(body.receipt_number ?? ''))

  if (!branchId || !taskDefinitionId || !fullName) {
    return NextResponse.json({ error: 'الفرع والمهمة والاسم مطلوبة' }, { status: 400 })
  }
  if (!canStaffWriteBranch(auth.profile, branchId)) return apiForbiddenResponse()

  const admin = createAdminClient()
  const { data: branch } = await admin.from('branches').select('id, name').eq('id', branchId).maybeSingle()
  if (!branch || isMainBranchName(branch.name)) {
    return NextResponse.json({ error: 'يجب اختيار فرعاً رسمياً قبل إضافة مدين' }, { status: 400 })
  }

  if (isReceiptNumberMissing(receiptNumber)) {
    return NextResponse.json({ error: RECEIPT_NUMBER_EMPTY_ERROR }, { status: 400 })
  }
  const dup = await findDuplicateReceiptInBranch(admin, branchId, receiptNumber)
  if (dup.error) return NextResponse.json({ error: dup.error }, { status: 500 })
  if (dup.duplicate) return NextResponse.json({ error: RECEIPT_NUMBER_DUP_BRANCH_ERROR }, { status: 400 })

  const { data: taskDef, error: tdErr } = await admin
    .from('task_definitions')
    .select('id, fee_amount, task_type')
    .eq('id', taskDefinitionId)
    .eq('branch_id', branchId)
    .maybeSingle()
  if (tdErr || !taskDef?.task_type) {
    return NextResponse.json({ error: 'تعريف المهمة غير صالح لهذا الفرع' }, { status: 400 })
  }

  const remaining = Number(body.remaining_amount ?? 0) || 0
  const receiptAmount = Number(body.receipt_amount ?? 0) || 0
  const penalty = body.has_contract ? Number(body.penalty_amount ?? 0) || 0 : 0
  const required = computeDebtorRequiredAmount(remaining, penalty, receiptAmount)
  const balanceRemaining = computeRemainingFromRequired(required, 0)
  const today = new Date().toISOString().split('T')[0]

  const { data: newDebtor, error: dbError } = await admin
    .from('debtors')
    .insert({
      full_name: fullName,
      phone: String(body.phone ?? '').trim() || null,
      governorate: null,
      address: String(body.address ?? '').trim() || null,
      id_number: String(body.id_number ?? '').trim() || null,
      export_date: today,
      receipt_type: body.receipt_type ?? 'other',
      receipt_number: receiptNumber,
      receipt_amount: receiptAmount,
      remaining_amount: balanceRemaining,
      required_amount: required,
      lawyer_fees: 0,
      penalty_amount: penalty,
      receipt_signed_legal_costs: Boolean(body.receipt_signed_legal_costs),
      notes: String(body.notes ?? '').trim() || null,
      created_by: auth.user!.id,
      branch_id: branchId,
      branch_list_id: String(body.branch_list_id ?? '').trim() || null,
    })
    .select('id')
    .single()

  if (dbError || !newDebtor) {
    return NextResponse.json({ error: dbError?.message ?? 'فشل إنشاء المدين' }, { status: 500 })
  }

  const notes = String(body.notes ?? '').trim()
  if (notes) {
    await admin.from('debtor_notes').insert({
      debtor_id: newDebtor.id,
      user_id: auth.user!.id,
      message: notes,
    })
  }

  const { data: newTask, error: taskErr } = await admin
    .from('tasks')
    .insert({
      debtor_id: newDebtor.id,
      task_definition_id: taskDefinitionId,
      task_type: taskDef.task_type,
      task_status: 'waiting_assignment',
      reward_amount: taskDef.fee_amount ?? 0,
      created_by: auth.user!.id,
      branch_id: branchId,
    })
    .select('id')
    .single()

  if (taskErr || !newTask) {
    await admin.from('debtors').delete().eq('id', newDebtor.id)
    return NextResponse.json({ error: `فشل إنشاء المهمة الأولية: ${taskErr?.message ?? ''}` }, { status: 500 })
  }

  const { error: linkErr } = await admin
    .from('debtors')
    .update({ current_task_id: newTask.id })
    .eq('id', newDebtor.id)
  if (linkErr) {
    await admin.from('tasks').delete().eq('id', newTask.id)
    await admin.from('debtors').delete().eq('id', newDebtor.id)
    return NextResponse.json({ error: `فشل ربط المهمة بالمدين: ${linkErr.message}` }, { status: 500 })
  }

  await logActivity({
    action: 'create_debtor',
    entity_type: 'debtor',
    entity_id: newDebtor.id,
    description: `إضافة مدين: ${fullName}`,
  }, auth.supabase)

  return NextResponse.json({ ok: true, id: newDebtor.id, taskId: newTask.id })
}
