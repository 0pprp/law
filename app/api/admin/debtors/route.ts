import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { canStaffReadBranch, canStaffWriteBranch } from '@/lib/staff-branch-access'
import { canAddDebtor, canUseViewAllBranchesFilter } from '@/lib/permissions'
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
import {
  assertDebtorSection,
  filterBySection,
  normalizeBranchListForCaseType,
  rejectBranchListForCriminal,
  sectionForbiddenResponse,
} from '@/lib/case-scope'
import { upsertCriminalDebtorDetails } from '@/lib/criminal-debtor-details'
import { cleanupFailedDebtorCreate } from '@/lib/debtor-hard-delete'

/** مبلغ اختياري للجزائي: null/فارغ → 0؛ سالب → خطأ */
function parseOptionalNonNegativeAmount(value: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (value == null || value === '') return { ok: true, value: 0 }
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'المبلغ يجب أن يكون رقماً موجباً أو فارغاً' }
  }
  return { ok: true, value: n }
}

function isValidOptionalDate(value: unknown): boolean {
  if (value == null || value === '') return true
  const s = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const DEFAULT_COLS =
  'id, full_name, phone, id_number, receipt_type, receipt_number, required_amount, remaining_amount, created_at, case_status, case_type, branch_list_id, branch_id, branch_list:branch_lists(name)'

export async function GET(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error

  const { searchParams } = new URL(request.url)
  const branchId = searchParams.get('branchId')?.trim() || null
  const viewAll = searchParams.get('viewAll') === '1'
  const listId = searchParams.get('listId')?.trim() || ''
  const search = searchParams.get('search')?.trim() || ''
  const caseType = searchParams.get('caseType')?.trim() || ''
  const offset = Math.max(0, Number(searchParams.get('offset') ?? 0) || 0)
  const limit = Math.min(5000, Math.max(1, Number(searchParams.get('limit') ?? 50) || 50))
  const cols = searchParams.get('cols')?.trim() || DEFAULT_COLS

  if (viewAll) {
    if (!canUseViewAllBranchesFilter(auth.profile?.role, auth.profile?.accountant_type)) {
      return apiForbiddenResponse()
    }
  } else if (!branchId) {
    return NextResponse.json({ error: 'معرّف الفرع مطلوب' }, { status: 400 })
  } else if (!canStaffReadBranch(auth.profile, branchId)) {
    return apiForbiddenResponse()
  }

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const scopeCaseType = filterBySection(scope)

  let q = admin
    .from('debtors')
    .select(cols, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (!viewAll && branchId) q = q.eq('branch_id', branchId)
  if (listId) {
    // تأكد أن القائمة تتبع الفرع المحدد (منع تسريب عبر listId خارج النطاق)
    // الجزائي لا يستخدم القوائم — تجاهل listId عند نطاق جزائي قسري
    if (scopeCaseType === 'criminal') {
      /* ignore list filter for criminal scope */
    } else if (branchId) {
      const { data: listOk } = await admin
        .from('branch_lists')
        .select('id')
        .eq('id', listId)
        .eq('branch_id', branchId)
        .maybeSingle()
      if (!listOk) {
        return NextResponse.json({ debtors: [], total: 0 })
      }
      q = q.eq('branch_list_id', listId)
    } else {
      q = q.eq('branch_list_id', listId)
    }
  }
  // نطاق الدور يفرض القسم؛ معامل caseType اختياري فقط ضمن both
  if (scopeCaseType) {
    q = q.eq('case_type', scopeCaseType)
  } else if (caseType === 'civil' || caseType === 'criminal') {
    q = q.eq('case_type', caseType)
  }
  if (search) {
    const s = search.replace(/[%_,]/g, '')
    q = q.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%,receipt_number.ilike.%${s}%`)
  }

  const { data, count, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let debtors = (data ?? []) as unknown as Array<Record<string, unknown> & { branch_id?: string | null }>
  if (viewAll && debtors.length) {
    const branchIds = [...new Set(
      debtors.map(d => d.branch_id).filter(Boolean),
    )] as string[]
    if (branchIds.length) {
      const { data: branches } = await admin.from('branches').select('id, name').in('id', branchIds)
      const nameMap = new Map((branches ?? []).map(b => [b.id, b.name]))
      debtors = debtors.map(d => ({
        ...d,
        branch_name: d.branch_id ? nameMap.get(d.branch_id) ?? null : null,
      }))
    }
  }

  return NextResponse.json({ debtors, total: count ?? 0 })
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
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
  const caseTypeRaw = String(body.case_type ?? '').trim()
  if (caseTypeRaw !== 'civil' && caseTypeRaw !== 'criminal') {
    return NextResponse.json({ error: 'يجب اختيار نوع الدعوى (مدنية أو جزائية)' }, { status: 400 })
  }
  const caseType = caseTypeRaw
  const scope = sessionCaseScope(auth.profile)
  if (!assertDebtorSection(scope, caseType)) return sectionForbiddenResponse()

  const listReject = rejectBranchListForCriminal(caseType, body.branch_list_id as string | null)
  if (listReject) return NextResponse.json({ error: listReject }, { status: 400 })
  const branchListId = normalizeBranchListForCaseType(caseType, body.branch_list_id as string | null)

  // المهمة اختيارية — بدونها يظهر المدين في «الأسماء التي تحت إسناد مهمة»
  if (!branchId || !fullName) {
    return NextResponse.json({ error: 'الفرع والاسم مطلوبان' }, { status: 400 })
  }
  if (!canStaffWriteBranch(auth.profile, branchId)) return apiForbiddenResponse()

  const admin = createAdminClient()
  const { data: branch } = await admin.from('branches').select('id, name').eq('id', branchId).maybeSingle()
  if (!branch || isMainBranchName(branch.name)) {
    return NextResponse.json({ error: 'يجب اختيار فرعاً رسمياً قبل إضافة مدين' }, { status: 400 })
  }

  const isCriminal = caseType === 'criminal'

  // المدني: رقم الوصل إلزامي؛ الجزائي: الاسم والفرع فقط
  if (!isCriminal) {
    if (isReceiptNumberMissing(receiptNumber)) {
      return NextResponse.json({ error: RECEIPT_NUMBER_EMPTY_ERROR }, { status: 400 })
    }
    const dup = await findDuplicateReceiptInBranch(admin, branchId, receiptNumber)
    if (dup.error) return NextResponse.json({ error: dup.error }, { status: 500 })
    if (dup.duplicate) return NextResponse.json({ error: RECEIPT_NUMBER_DUP_BRANCH_ERROR }, { status: 400 })
  } else if (receiptNumber) {
    const dup = await findDuplicateReceiptInBranch(admin, branchId, receiptNumber)
    if (dup.error) return NextResponse.json({ error: dup.error }, { status: 500 })
    if (dup.duplicate) return NextResponse.json({ error: RECEIPT_NUMBER_DUP_BRANCH_ERROR }, { status: 400 })
  }

  type TaskDefRow = { id: string; fee_amount: number | null; task_type: string; case_type?: string }
  let taskDef: TaskDefRow | null = null
  if (taskDefinitionId) {
    const { data: td, error: tdErr } = await admin
      .from('task_definitions')
      .select('id, fee_amount, task_type, case_type')
      .eq('id', taskDefinitionId)
      .eq('branch_id', branchId)
      .maybeSingle()
    if (tdErr || !td?.task_type) {
      return NextResponse.json({ error: 'تعريف المهمة غير صالح لهذا الفرع' }, { status: 400 })
    }
    const defCase = (td as { case_type?: string }).case_type === 'criminal' ? 'criminal' : 'civil'
    if (defCase !== caseType) {
      return NextResponse.json({ error: 'تعريف المهمة لا يطابق نوع الدعوى المختار' }, { status: 400 })
    }
    taskDef = {
      id: String(td.id),
      fee_amount: td.fee_amount == null ? null : Number(td.fee_amount),
      task_type: String(td.task_type),
      case_type: (td as { case_type?: string }).case_type,
    }
  }

  let remaining = 0
  let receiptAmount = 0
  let penalty = 0
  if (isCriminal) {
    const amt = parseOptionalNonNegativeAmount(body.remaining_amount ?? body.amount_owed)
    if (!amt.ok) return NextResponse.json({ error: amt.error }, { status: 400 })
    remaining = amt.value
    const details = body.criminal_details
    if (details && typeof details === 'object') {
      const incident = (details as Record<string, unknown>).incident_date
      if (!isValidOptionalDate(incident)) {
        return NextResponse.json({ error: 'تاريخ الواقعة غير صالح' }, { status: 400 })
      }
    }
  } else {
    remaining = Number(body.remaining_amount ?? 0) || 0
    receiptAmount = Number(body.receipt_amount ?? 0) || 0
    penalty = body.has_contract ? Number(body.penalty_amount ?? 0) || 0 : 0
  }
  const required = computeDebtorRequiredAmount(remaining, 0, penalty, receiptAmount)
  const balanceRemaining = computeRemainingFromRequired(required, 0)
  const today = new Date().toISOString().split('T')[0]

  const { data: newDebtor, error: dbError } = await admin
    .from('debtors')
    .insert({
      full_name: fullName,
      phone: isCriminal ? null : (String(body.phone ?? '').trim() || null),
      governorate: null,
      address: isCriminal
        ? null
        : (String(body.address ?? '').trim() || null),
      id_number: isCriminal ? null : (String(body.id_number ?? '').trim() || null),
      export_date: today,
      receipt_type: isCriminal ? 'other' : (body.receipt_type ?? 'other'),
      receipt_number: isCriminal ? (receiptNumber || null) : receiptNumber,
      receipt_amount: receiptAmount,
      remaining_amount: balanceRemaining,
      required_amount: required,
      lawyer_fees: 0,
      penalty_amount: penalty,
      receipt_signed_legal_costs: isCriminal ? false : Boolean(body.receipt_signed_legal_costs),
      notes: String(body.notes ?? '').trim() || null,
      created_by: auth.user!.id,
      branch_id: branchId,
      branch_list_id: isCriminal ? null : branchListId,
      case_type: caseType,
    })
    .select('id')
    .single()

  if (dbError || !newDebtor) {
    return NextResponse.json({ error: dbError?.message ?? 'فشل إنشاء المدين' }, { status: 500 })
  }

  if (isCriminal) {
    const detailsInput =
      body.criminal_details && typeof body.criminal_details === 'object'
        ? (body.criminal_details as Record<string, string | null>)
        : {}
    const detailsRes = await upsertCriminalDebtorDetails(admin, newDebtor.id, detailsInput)
    if (detailsRes.error) {
      const cleaned = await cleanupFailedDebtorCreate(admin, newDebtor.id, { caseType: 'criminal' })
      return NextResponse.json(
        {
          error: cleaned.ok
            ? `فشل حفظ تفاصيل المدين الجزائي: ${detailsRes.error}`
            : `فشل حفظ التفاصيل وتعذّر التراجع: ${cleaned.error}`,
        },
        { status: 500 },
      )
    }
  }

  const notes = String(body.notes ?? '').trim()
  if (notes) {
    await admin.from('debtor_notes').insert({
      debtor_id: newDebtor.id,
      user_id: auth.user!.id,
      message: notes,
    })
  }

  // بدون مهمة مختارة: يبقى current_task_id فارغاً ويظهر المدين في «الأسماء التي تحت إسناد مهمة»
  if (!taskDef) {
    await logActivity({
      action: 'create_debtor',
      entity_type: 'debtor',
      entity_id: newDebtor.id,
      description: isCriminal
        ? `إضافة مدين جزائي: ${fullName}`
        : `إضافة مدين بدون مهمة مطلوبة: ${fullName}`,
      case_type: caseType,
    }, auth.supabase)
    return NextResponse.json({ ok: true, id: newDebtor.id, taskId: null })
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
    const cleaned = await cleanupFailedDebtorCreate(admin, newDebtor.id, {
      caseType: isCriminal ? 'criminal' : 'civil',
    })
    return NextResponse.json({
      error: cleaned.ok
        ? `فشل إنشاء المهمة الأولية: ${taskErr?.message ?? ''}`
        : `فشل إنشاء المهمة وتعذّر التراجع: ${cleaned.error}`,
    }, { status: 500 })
  }

  const { error: linkErr } = await admin
    .from('debtors')
    .update({ current_task_id: newTask.id })
    .eq('id', newDebtor.id)
  if (linkErr) {
    const cleaned = await cleanupFailedDebtorCreate(admin, newDebtor.id, {
      caseType: isCriminal ? 'criminal' : 'civil',
      alsoDeleteTaskIds: [newTask.id],
    })
    return NextResponse.json({
      error: cleaned.ok
        ? `فشل ربط المهمة بالمدين: ${linkErr.message}`
        : `فشل الربط وتعذّر التراجع: ${cleaned.error}`,
    }, { status: 500 })
  }

  await logActivity({
    action: 'create_debtor',
    entity_type: 'debtor',
    entity_id: newDebtor.id,
    description: `إضافة مدين: ${fullName}`,
    case_type: caseType,
  }, auth.supabase)

  return NextResponse.json({ ok: true, id: newDebtor.id, taskId: newTask.id })
}
