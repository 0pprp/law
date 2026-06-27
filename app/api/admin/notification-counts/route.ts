import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBranchContext } from '@/lib/branch-context'
import { REVIEW_QUEUE_STATUSES } from '@/lib/task-assignment'

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

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'employee', 'accountant'].includes(profile.role)) {
      return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
    }

    const { branchId } = await getBranchContext()
    if (!branchId) {
      return NextResponse.json({
        pendingReview: 0,
        pendingPayoutRequests: 0,
        pendingTaskFeeReceipts: 0,
        pendingExpenses: 0,
        pendingExpensesByType: [],
      })
    }

    const admin = createAdminClient()

    const { data: lawyers } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'lawyer')
      .eq('is_active', true)
      .eq('branch_id', branchId)

    const lawyerIds = (lawyers ?? []).map(l => l.id)

    const { data: branchDebtors } = await admin
      .from('debtors')
      .select('id')
      .eq('branch_id', branchId)

    const debtorIds = (branchDebtors ?? []).map(d => d.id)

    let expenseQ = admin
      .from('expenses')
      .select('id, expense_type')
      .eq('status', 'pending_approval')

    if (debtorIds.length) {
      expenseQ = expenseQ.in('debtor_id', debtorIds)
    } else {
      expenseQ = expenseQ.eq('branch_id', branchId)
    }

    const [reviewRes, payoutRes, feeReceiptRes, expenseRes] = await Promise.all([
      admin
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('branch_id', branchId)
        .in('task_status', [...REVIEW_QUEUE_STATUSES]),
      lawyerIds.length
        ? admin
            .from('lawyer_payout_requests')
            .select('id', { count: 'exact', head: true })
            .in('lawyer_id', lawyerIds)
            .eq('status', 'pending')
        : Promise.resolve({ count: 0 }),
      lawyerIds.length
        ? admin
            .from('task_payment_receipts')
            .select('id', { count: 'exact', head: true })
            .in('lawyer_id', lawyerIds)
            .eq('status', 'pending')
        : Promise.resolve({ count: 0 }),
      expenseQ.limit(500),
    ])

    const pendingExpenseRows = expenseRes.data ?? []

    return NextResponse.json({
      pendingReview: reviewRes.count ?? 0,
      pendingPayoutRequests: payoutRes.count ?? 0,
      pendingTaskFeeReceipts: feeReceiptRes.count ?? 0,
      pendingExpenses: pendingExpenseRows.length,
      pendingExpensesByType: groupPendingExpenses(pendingExpenseRows),
    })
  } catch (e) {
    console.error('[admin/notification-counts]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
