import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canAddDebtorExpenses } from '@/lib/permissions'
import { canStaffReadBranch, canStaffWriteBranch } from '@/lib/staff-branch-access'
import { requireDebtorInScope } from '@/lib/section-guard'
import { logActivity } from '@/lib/activity-log'
import { formatMoney } from '@/lib/money-input'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import { localTodayYmd } from '@/lib/local-date'
import { fetchFilterLawyers, isLawyerRole } from '@/lib/branch-profiles'
import { isGeneralLawyerType } from '@/lib/lawyer-type'
import { fetchLawyerSavingsBalancesMap } from '@/lib/lawyer-wallet'
import { deductLawyerWalletForDebtorExpense } from '@/lib/expense-wallet'

const MANUAL_EXPENSE_TYPE = 'صرفية يدوية'

/**
 * قائمة المحامين مع رصيد محفظة الصرفيات — لنموذج إضافة صرفية على مدين.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error
    if (!canAddDebtorExpenses(auth.profile?.role)) return apiForbiddenResponse()

    const requestedBranch = request.nextUrl.searchParams.get('branchId')?.trim() || null
    const branchId = requestedBranch || auth.profile?.branch_id || null
    if (branchId && !canStaffReadBranch(auth.profile, branchId)) {
      return apiForbiddenResponse()
    }

    const admin = createAdminClient()
    const { lawyers, error } = await fetchFilterLawyers(admin, branchId)
    if (error) {
      return apiServerError('expenses GET lawyers', error as Error)
    }

    const ids = lawyers.map(l => l.id)
    const savingsMap = await fetchLawyerSavingsBalancesMap(admin, ids)

    return NextResponse.json({
      ok: true,
      lawyers: lawyers.map(l => ({
        id: l.id,
        full_name: l.full_name,
        savings: savingsMap.get(l.id) ?? 0,
      })),
    })
  } catch (e) {
    console.error('[admin/expenses GET]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}

/**
 * إضافة صرفية يدوية للمدين (بدون مهمة) — معتمدة مباشرة.
 * تخصم من محفظة صرفيات المحامي المختار وتُسجَّل في تبويب الصرفيات.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffProfile()
  if (auth.error) return auth.error
  if (!canAddDebtorExpenses(auth.profile?.role)) return apiForbiddenResponse()

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return safeClientError('طلب غير صالح', 400)
  }

  const debtorId = String(body.debtorId ?? body.debtor_id ?? '').trim()
  const lawyerId = String(body.lawyerId ?? body.lawyer_id ?? '').trim()
  const note = String(body.note ?? body.description ?? '').trim()
  const amount = Number(body.amount)
  const expenseDate = String(body.expenseDate ?? body.expense_date ?? '').trim() || localTodayYmd()

  if (!debtorId) return safeClientError('المدين مطلوب', 400)
  if (!lawyerId) return safeClientError('اختر محفظة صرفيات المحامي', 400)
  if (!note) return safeClientError('اكتب ملاحظة عن سبب هذه الصرفية', 400)
  if (!Number.isFinite(amount) || amount <= 0) return safeClientError('المبلغ يجب أن يكون أكبر من صفر', 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    return safeClientError('تاريخ الصرفية غير صالح', 400)
  }

  const admin = createAdminClient()
  const scope = sessionCaseScope(auth.profile)
  const gate = await requireDebtorInScope(
    admin,
    scope,
    debtorId,
    'id, branch_id, case_type, full_name',
  )
  if (!gate.ok) return gate.error

  const debtor = gate.data as {
    id: string
    branch_id: string | null
    case_type?: string | null
    full_name?: string | null
  }

  if (!canStaffWriteBranch(auth.profile, debtor.branch_id)) return apiForbiddenResponse()

  const { data: lawyer, error: lawyerErr } = await admin
    .from('profiles')
    .select('id, role, branch_id, lawyer_type, is_active, full_name')
    .eq('id', lawyerId)
    .maybeSingle()

  if (lawyerErr) return apiServerError('expenses POST lawyer', lawyerErr)
  if (!lawyer || !isLawyerRole(lawyer.role) || lawyer.is_active === false) {
    return safeClientError('المحامي غير موجود أو غير نشط', 400)
  }
  if (
    debtor.branch_id
    && lawyer.branch_id
    && lawyer.branch_id !== debtor.branch_id
    && !isGeneralLawyerType(lawyer.lawyer_type)
  ) {
    return safeClientError('المحامي لا ينتمي لفرع هذا المدين', 400)
  }

  const now = new Date().toISOString()
  const { data: inserted, error: insertErr } = await admin
    .from('expenses')
    .insert({
      debtor_id: debtorId,
      task_id: null,
      lawyer_id: lawyerId,
      amount,
      expense_type: MANUAL_EXPENSE_TYPE,
      description: note,
      expense_date: expenseDate,
      created_by: auth.user!.id,
      status: 'approved',
      approved_at: now,
      approved_by: auth.user!.id,
      branch_id: debtor.branch_id,
    } as any)
    .select('id')
    .single()

  if (insertErr || !inserted) {
    return apiServerError('expenses POST insert', insertErr ?? new Error('insert failed'))
  }

  const deducted = await deductLawyerWalletForDebtorExpense(admin, {
    lawyerId,
    amount,
    expenseId: inserted.id,
    actorId: auth.user!.id,
    debtorName: debtor.full_name ?? '',
    note,
  })

  if (!deducted.ok) {
    await admin.from('expenses').delete().eq('id', inserted.id)
    return safeClientError(deducted.error, 400)
  }

  await logActivity({
    action: 'add_expense',
    entity_type: 'expense',
    entity_id: inserted.id,
    description: `إضافة صرفية يدوية — ${debtor.full_name ?? ''} — محفظة صرفيات ${lawyer.full_name ?? ''} — ${formatMoney(amount)}`,
    case_type: debtor.case_type === 'criminal' ? 'criminal' : 'civil',
  }, admin)

  return NextResponse.json({
    ok: true,
    id: inserted.id,
    case_type: gate.caseType,
  })
}
