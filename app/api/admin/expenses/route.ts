import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canAddDebtorExpenses } from '@/lib/permissions'
import { canStaffWriteBranch } from '@/lib/staff-branch-access'
import { requireDebtorInScope } from '@/lib/section-guard'
import { logActivity } from '@/lib/activity-log'
import { formatMoney } from '@/lib/money-input'
import { safeClientError, apiServerError } from '@/lib/safe-api-error'
import { localTodayYmd } from '@/lib/local-date'

const MANUAL_EXPENSE_TYPE = 'صرفية يدوية'

/**
 * إضافة صرفية يدوية للمدين (بدون مهمة) — معتمدة مباشرة.
 * للمدير والمحاسب فقط. الحقول: المبلغ + التاريخ.
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
  const amount = Number(body.amount)
  const expenseDate = String(body.expenseDate ?? body.expense_date ?? '').trim() || localTodayYmd()

  if (!debtorId) return safeClientError('المدين مطلوب', 400)
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

  const now = new Date().toISOString()
  const { data: inserted, error: insertErr } = await admin
    .from('expenses')
    .insert({
      debtor_id: debtorId,
      task_id: null,
      amount,
      expense_type: MANUAL_EXPENSE_TYPE,
      description: MANUAL_EXPENSE_TYPE,
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

  await logActivity({
    action: 'add_expense',
    entity_type: 'expense',
    entity_id: inserted.id,
    description: `إضافة صرفية يدوية — ${debtor.full_name ?? ''} — ${formatMoney(amount)}`,
    case_type: debtor.case_type === 'criminal' ? 'criminal' : 'civil',
  }, admin)

  return NextResponse.json({
    ok: true,
    id: inserted.id,
    case_type: gate.caseType,
  })
}
