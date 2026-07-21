import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canAddDebtor, canDelete, canEditDebtor } from '@/lib/permissions'
import {
  assertDebtorSafeToHardDelete,
  cleanupFailedDebtorCreate,
} from '@/lib/debtor-hard-delete'
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
import {
  assertDebtorSection,
  normalizeBranchListForCaseType,
  rejectBranchListForCriminal,
  sectionForbiddenResponse,
} from '@/lib/case-scope'
import { fetchCriminalDebtorDetails, upsertCriminalDebtorDetails } from '@/lib/criminal-debtor-details'

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

  const scope = sessionCaseScope(auth.profile)
  if (!assertDebtorSection(scope, (debtor as { case_type?: string }).case_type)) {
    return sectionForbiddenResponse()
  }

  const { data: attachments, error: attachmentsError } = await admin
    .from('debtor_attachments')
    .select('id, file_name, file_path, file_size')
    .eq('debtor_id', id)

  if (attachmentsError) {
    return NextResponse.json({ error: attachmentsError.message }, { status: 500 })
  }

  let criminal_details = null
  if ((debtor as { case_type?: string }).case_type === 'criminal') {
    criminal_details = await fetchCriminalDebtorDetails(admin, id)
  }

  return NextResponse.json({ debtor, attachments: attachments ?? [], criminal_details })
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canEditDebtor(auth.profile?.role)) return apiForbiddenResponse()

  const { id } = await params
  const admin = createAdminClient()
  const { data: debtor, error: debtorError } = await admin
    .from('debtors')
    .select('id, branch_id, total_payments, total_expenses, case_type')
    .eq('id', id)
    .maybeSingle()

  if (debtorError) return NextResponse.json({ error: debtorError.message }, { status: 500 })
  if (!debtor) return NextResponse.json({ error: 'المدين غير موجود' }, { status: 404 })
  if (!canStaffWriteBranch(auth.profile, debtor.branch_id)) return apiForbiddenResponse()

  const scope = sessionCaseScope(auth.profile)
  if (!assertDebtorSection(scope, debtor.case_type)) return sectionForbiddenResponse()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  // ممنوع تغيير case_type بعد الإنشاء
  if (body.case_type != null && String(body.case_type).trim() !== '' && String(body.case_type) !== debtor.case_type) {
    return NextResponse.json({ error: 'لا يمكن تغيير نوع الدعوى بعد إنشاء المدين' }, { status: 400 })
  }

  const isCriminal = debtor.case_type === 'criminal'
  const fullName = String(body.full_name ?? '').trim()
  if (!fullName) return NextResponse.json({ error: 'الاسم الكامل مطلوب' }, { status: 400 })

  const listReject = rejectBranchListForCriminal(debtor.case_type, body.branch_list_id as string | null)
  if (listReject) return NextResponse.json({ error: listReject }, { status: 400 })
  const branchListId = normalizeBranchListForCaseType(debtor.case_type, body.branch_list_id as string | null)

  if (isCriminal) {
    // الجزائي: لا يُعدّل case_type ولا branch_list؛ الحقول المدنية الثقيلة اختيارية/متجاهلة
    if (body.branch_list_id != null && String(body.branch_list_id).trim() !== '') {
      return NextResponse.json({ error: 'لا يمكن تعيين قائمة للمدين الجزائي' }, { status: 400 })
    }

    const updatePayload: Record<string, unknown> = {
      full_name: fullName,
      notes: String(body.notes ?? '').trim() || null,
      branch_list_id: null,
      phone: null,
    }

    if (body.remaining_amount !== undefined || body.amount_owed !== undefined) {
      const raw = body.remaining_amount ?? body.amount_owed
      if (raw == null || raw === '') {
        if (Number(debtor.total_payments ?? 0) === 0) {
          updatePayload.required_amount = 0
          updatePayload.remaining_amount = 0
        }
      } else {
        const n = Number(raw)
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: 'المبلغ يجب أن يكون رقماً موجباً أو فارغاً' }, { status: 400 })
        }
        if (Number(debtor.total_payments ?? 0) === 0) {
          const required = computeDebtorRequiredAmount(n, Number(debtor.total_expenses ?? 0), 0, 0)
          updatePayload.required_amount = required
          updatePayload.remaining_amount = computeRemainingFromRequired(required, 0)
        }
      }
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

    if (body.criminal_details && typeof body.criminal_details === 'object') {
      const detailsRes = await upsertCriminalDebtorDetails(
        admin,
        id,
        body.criminal_details as Record<string, string | null>,
      )
      if (detailsRes.error) {
        return NextResponse.json({ error: detailsRes.error }, { status: 400 })
      }
    }

    await logActivity({
      action: 'update_debtor',
      entity_type: 'debtor',
      entity_id: id,
      description: `تعديل بيانات المدين الجزائي: ${fullName}`,
      case_type: 'criminal',
    }, auth.supabase)

    return NextResponse.json({ ok: true })
  }

  const receiptNumber = normalizeReceiptNumberInput(String(body.receipt_number ?? ''))
  const receiptType = String(body.receipt_type ?? '') as ReceiptType
  const receiptAmount = amount(body.receipt_amount)
  const receiptRemaining = amount(body.remaining_amount)
  const lawyerFees = amount(body.lawyer_fees)
  const hasContract = Boolean(body.has_contract)
  const penalty = hasContract ? amount(body.penalty_amount) : 0

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
    case_type: 'civil',
  }, auth.supabase)

  return NextResponse.json({ ok: true })
}

/**
 * حذف مدين:
 * - admin عبر canDelete مع منع الحذف عند وجود علاقات تشغيلية
 * - أو rollback إنشاء فاشل: canAddDebtor + created_by = المستخدم + عمر قصير + بلا تسديدات
 * لا يُستخدم كحذف تشغيلي عام لمسؤولي الأقسام.
 */
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const { id } = await params
  const admin = createAdminClient()
  const { data: debtor, error } = await admin
    .from('debtors')
    .select('id, branch_id, case_type, full_name, created_by, created_at')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!debtor) return NextResponse.json({ error: 'المدين غير موجود' }, { status: 404 })
  if (!canStaffWriteBranch(auth.profile, debtor.branch_id)) return apiForbiddenResponse()

  const scope = sessionCaseScope(auth.profile)
  if (!assertDebtorSection(scope, debtor.case_type)) return sectionForbiddenResponse()

  const isAdminDelete = canDelete(auth.profile?.role)
  const createdAtMs = debtor.created_at ? Date.parse(String(debtor.created_at)) : NaN
  const isFreshCreate =
    Number.isFinite(createdAtMs) && Date.now() - createdAtMs < 15 * 60_000
  const isCreateRollback =
    canAddDebtor(auth.profile?.role)
    && debtor.created_by === auth.user!.id
    && isFreshCreate

  if (!isAdminDelete && !isCreateRollback) {
    return apiForbiddenResponse()
  }

  // Rollback: allow deleting the initial waiting task created with the debtor
  if (isCreateRollback && !isAdminDelete) {
    const { count: payCount } = await admin
      .from('debtor_payments')
      .select('id', { count: 'exact', head: true })
      .eq('debtor_id', id)
    if ((payCount ?? 0) > 0) {
      return NextResponse.json({ error: 'لا يمكن التراجع عن مدين لديه تسديدات' }, { status: 409 })
    }
    const { data: tasks } = await admin
      .from('tasks')
      .select('id, task_status')
      .eq('debtor_id', id)
    const blocking = (tasks ?? []).filter((t) => t.task_status !== 'waiting_assignment')
    if (blocking.length) {
      return NextResponse.json({ error: 'لا يمكن التراجع عن مدين لديه مهام نشطة' }, { status: 409 })
    }
    const taskIds = (tasks ?? []).map((t) => t.id)
    const cleaned = await cleanupFailedDebtorCreate(admin, id, {
      caseType: debtor.case_type === 'criminal' ? 'criminal' : 'civil',
      alsoDeleteTaskIds: taskIds,
    })
    if (!cleaned.ok) {
      return NextResponse.json({ error: cleaned.error || 'فشل حذف المدين' }, { status: 500 })
    }
  } else {
    const safe = await assertDebtorSafeToHardDelete(admin, id)
    if (!safe.ok) {
      const messages: Record<string, string> = {
        payments: 'لا يمكن حذف مدين لديه تسديدات',
        tasks: 'لا يمكن حذف مدين لديه مهام',
        attachments: 'لا يمكن حذف مدين لديه مرفقات',
        expenses: 'لا يمكن حذف مدين لديه صرفيات',
        wallet: 'لا يمكن حذف مدين لديه حركات مالية',
        not_found: 'المدين غير موجود',
      }
      return NextResponse.json(
        { error: messages[safe.reason] ?? 'الحذف مرفوض' },
        { status: 409 },
      )
    }
    const cleaned = await cleanupFailedDebtorCreate(admin, id, {
      caseType: debtor.case_type === 'criminal' ? 'criminal' : 'civil',
    })
    if (!cleaned.ok) {
      return NextResponse.json({ error: cleaned.error || 'فشل حذف المدين' }, { status: 500 })
    }
  }

  await logActivity({
    action: 'delete_debtor',
    entity_type: 'debtor',
    entity_id: id,
    description: `حذف المدين: ${debtor.full_name ?? id}`,
    case_type: debtor.case_type === 'criminal' ? 'criminal' : 'civil',
  }, auth.supabase)

  return NextResponse.json({ ok: true })
}
