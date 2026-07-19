import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile } from '@/lib/api-auth'
import { apiForbiddenResponse, canEditDebtor } from '@/lib/permissions'
import { canStaffReadBranch, canStaffWriteBranch } from '@/lib/staff-branch-access'
import {
  findDuplicateReceiptInBranch,
  isReceiptNumberMissing,
  normalizeReceiptNumberInput,
  RECEIPT_NUMBER_DUP_BRANCH_ERROR,
  RECEIPT_NUMBER_EMPTY_ERROR,
} from '@/lib/receipt-number'
import { computeDebtorRequiredAmount, computeRemainingFromRequired } from '@/lib/debtor-balances'
import { logActivity } from '@/lib/activity-log'
import type { ReceiptType } from '@/lib/types'

type RouteContext = { params: Promise<{ id: string }> }

const RECEIPT_TYPES = new Set<ReceiptType>([
  'check',
  'bill_of_exchange',
  'trust',
  'contract',
  'other',
])

function amount(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const { id } = await params
  const admin = createAdminClient()
  const { data: debtor, error } = await admin
    .from('debtors')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!debtor) return NextResponse.json({ error: 'المدين غير موجود' }, { status: 404 })
  if (!canStaffReadBranch(auth.profile, debtor.branch_id)) return apiForbiddenResponse()

  const { data: attachments, error: attachmentsError } = await admin
    .from('debtor_attachments')
    .select('id, file_name, file_path, file_size')
    .eq('debtor_id', id)

  if (attachmentsError) {
    return NextResponse.json({ error: attachmentsError.message }, { status: 500 })
  }

  return NextResponse.json({ debtor, attachments: attachments ?? [] })
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canEditDebtor(auth.profile?.role)) return apiForbiddenResponse()

  const { id } = await params
  const admin = createAdminClient()
  const { data: debtor, error: debtorError } = await admin
    .from('debtors')
    .select('id, branch_id, total_payments, total_expenses')
    .eq('id', id)
    .maybeSingle()

  if (debtorError) return NextResponse.json({ error: debtorError.message }, { status: 500 })
  if (!debtor) return NextResponse.json({ error: 'المدين غير موجود' }, { status: 404 })
  if (!canStaffWriteBranch(auth.profile, debtor.branch_id)) return apiForbiddenResponse()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const fullName = String(body.full_name ?? '').trim()
  const receiptNumber = normalizeReceiptNumberInput(String(body.receipt_number ?? ''))
  const receiptType = String(body.receipt_type ?? '') as ReceiptType
  const receiptAmount = amount(body.receipt_amount)
  const receiptRemaining = amount(body.remaining_amount)
  const lawyerFees = amount(body.lawyer_fees)
  const hasContract = Boolean(body.has_contract)
  const penalty = hasContract ? amount(body.penalty_amount) : 0
  const branchListId = String(body.branch_list_id ?? '').trim() || null

  if (!fullName) return NextResponse.json({ error: 'الاسم الكامل مطلوب' }, { status: 400 })
  if (isReceiptNumberMissing(receiptNumber)) {
    return NextResponse.json({ error: RECEIPT_NUMBER_EMPTY_ERROR }, { status: 400 })
  }
  if (!RECEIPT_TYPES.has(receiptType)) {
    return NextResponse.json({ error: 'نوع السند غير صالح' }, { status: 400 })
  }
  if (receiptAmount == null || receiptRemaining == null || lawyerFees == null || penalty == null) {
    return NextResponse.json({ error: 'المبالغ يجب أن تكون أرقاماً صحيحة وغير سالبة' }, { status: 400 })
  }

  const duplicate = await findDuplicateReceiptInBranch(admin, debtor.branch_id, receiptNumber, id)
  if (duplicate.error) return NextResponse.json({ error: duplicate.error }, { status: 500 })
  if (duplicate.duplicate) {
    return NextResponse.json({ error: RECEIPT_NUMBER_DUP_BRANCH_ERROR }, { status: 400 })
  }

  if (branchListId) {
    const { data: list } = await admin
      .from('branch_lists')
      .select('id')
      .eq('id', branchListId)
      .eq('branch_id', debtor.branch_id)
      .maybeSingle()
    if (!list) return NextResponse.json({ error: 'القائمة لا تتبع فرع المدين' }, { status: 400 })
  }

  const updatePayload: Record<string, unknown> = {
    full_name: fullName,
    phone: String(body.phone ?? '').trim() || null,
    address: String(body.address ?? '').trim() || null,
    id_number: String(body.id_number ?? '').trim() || null,
    receipt_type: receiptType,
    receipt_number: receiptNumber,
    receipt_amount: receiptAmount,
    lawyer_fees: lawyerFees,
    penalty_amount: penalty,
    has_contract: hasContract,
    receipt_signed_legal_costs: Boolean(body.receipt_signed_legal_costs),
    notes: String(body.notes ?? '').trim() || null,
    branch_list_id: branchListId,
  }

  if (Number(debtor.total_payments ?? 0) === 0) {
    const required = computeDebtorRequiredAmount(
      receiptRemaining,
      Number(debtor.total_expenses ?? 0),
      penalty,
      receiptAmount,
    )
    updatePayload.required_amount = required
    updatePayload.remaining_amount = computeRemainingFromRequired(required, 0)
  }

  const { data: updated, error: updateError } = await admin
    .from('debtors')
    .update(updatePayload)
    .eq('id', id)
    .eq('branch_id', debtor.branch_id)
    .select('id')
    .maybeSingle()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  if (!updated) return NextResponse.json({ error: 'لم يتم تحديث المدين' }, { status: 409 })

  await logActivity({
    action: 'update_debtor',
    entity_type: 'debtor',
    entity_id: id,
    description: `تعديل بيانات المدين: ${fullName}`,
  }, auth.supabase)

  return NextResponse.json({ ok: true })
}
