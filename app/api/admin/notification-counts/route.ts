import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBranchContext } from '@/lib/branch-context'
import { fetchPendingReviewCount } from '@/lib/task-assignment'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { filterBySection } from '@/lib/case-scope'

function groupPendingExpenses(rows: { expense_type: string | null }[]) {
  const map = new Map<string, number>()
  for (const row of rows) {
    const type = row.expense_type?.trim() || 'صرفية'
    map.set(type, (map.get(type) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, 'ar'))
}

const CACHE_HEADERS = { 'Cache-Control': 'private, max-age=30' }

export async function GET() {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error

    const { branchId } = await getBranchContext()
    if (!branchId) {
      return NextResponse.json({
        pendingReview: 0,
        pendingPayoutRequests: 0,
        pendingTaskFeeReceipts: 0,
        pendingExpenses: 0,
        pendingExpensesByType: [],
      }, { headers: CACHE_HEADERS })
    }

    const admin = createAdminClient()
    const scopeCaseType = filterBySection(sessionCaseScope(auth.profile))

    // Align pendingReview with review page: assigned + open debtors only
    const reviewPromise = fetchPendingReviewCount(admin, branchId, null, scopeCaseType)

    let lawyersQ = admin
      .from('profiles')
      .select('id')
      .eq('role', 'lawyer')
      .eq('is_active', true)
      .eq('branch_id', branchId)
    if (scopeCaseType) lawyersQ = lawyersQ.eq('case_type', scopeCaseType)
    const { data: scopedLawyers } = await lawyersQ.limit(200)
    const scopedLawyerIds = (scopedLawyers ?? []).map(l => l.id)

    const payoutPromise = scopedLawyerIds.length
      ? admin
          .from('lawyer_payout_requests')
          .select('id', { count: 'exact', head: true })
          .eq('branch_id', branchId)
          .eq('status', 'pending')
          .in('lawyer_id', scopedLawyerIds)
      : Promise.resolve({ count: 0 })

    const feeReceiptPromise = scopedLawyerIds.length
      ? admin
          .from('task_payment_receipts')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .in('lawyer_id', scopedLawyerIds)
      : Promise.resolve({ count: 0 })

    let expenseQ = admin
      .from('expenses')
      .select('id, debtor:debtors!inner(case_type)', { count: 'exact', head: true })
      .eq('branch_id', branchId)
      .eq('status', 'pending_approval')
    if (scopeCaseType) expenseQ = expenseQ.eq('debtor.case_type', scopeCaseType)

    const [reviewRes, payoutRes, feeReceiptRes, expenseCountRes] = await Promise.all([
      reviewPromise,
      payoutPromise,
      feeReceiptPromise,
      expenseQ,
    ])

    const pendingExpenses = expenseCountRes.count ?? 0
    let pendingExpensesByType: { type: string; count: number }[] = []

    if (pendingExpenses > 0 && pendingExpenses <= 300) {
      let expenseRowsQ = admin
        .from('expenses')
        .select('expense_type, debtor:debtors!inner(case_type)')
        .eq('branch_id', branchId)
        .eq('status', 'pending_approval')
        .limit(300)
      if (scopeCaseType) expenseRowsQ = expenseRowsQ.eq('debtor.case_type', scopeCaseType)
      const { data: expenseRows } = await expenseRowsQ
      pendingExpensesByType = groupPendingExpenses(expenseRows ?? [])
    } else if (pendingExpenses > 300) {
      pendingExpensesByType = [{ type: 'صرفيات معلّقة', count: pendingExpenses }]
    }

    return NextResponse.json({
      pendingReview: reviewRes,
      pendingPayoutRequests: payoutRes.count ?? 0,
      pendingTaskFeeReceipts: feeReceiptRes.count ?? 0,
      pendingExpenses,
      pendingExpensesByType,
    }, { headers: CACHE_HEADERS })
  } catch (e) {
    console.error('[admin/notification-counts]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
