import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBranchContext } from '@/lib/branch-context'
import { REVIEW_QUEUE_STATUSES } from '@/lib/task-assignment'
import { STAFF_ROLES } from '@/lib/permissions'
import type { UserRole } from '@/lib/types'

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

async function countPendingFeeReceipts(
  admin: ReturnType<typeof createAdminClient>,
  branchId: string,
): Promise<number> {
  const joined = await admin
    .from('task_payment_receipts')
    .select('id, lawyer:profiles!task_payment_receipts_lawyer_id_fkey!inner(branch_id)', { count: 'exact', head: true })
    .eq('status', 'pending')
    .eq('lawyer.branch_id', branchId)

  if (!joined.error) return joined.count ?? 0

  const { data: lawyers } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'lawyer')
    .eq('is_active', true)
    .eq('branch_id', branchId)
    .limit(100)

  const ids = (lawyers ?? []).map(l => l.id)
  if (!ids.length) return 0

  const { count } = await admin
    .from('task_payment_receipts')
    .select('id', { count: 'exact', head: true })
    .in('lawyer_id', ids)
    .eq('status', 'pending')

  return count ?? 0
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

    if (!profile || !STAFF_ROLES.includes(profile.role as UserRole)) {
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
      }, { headers: CACHE_HEADERS })
    }

    const admin = createAdminClient()

    // Align pendingReview with review page: assigned + open debtors only
    let openDebtorsQ = admin
      .from('debtors')
      .select('id')
      .eq('branch_id', branchId)
      .not('case_status', 'eq', 'closed')
    const { data: openDebtors } = await openDebtorsQ
    const openIds = (openDebtors ?? []).map(d => d.id)

    const reviewPromise = openIds.length
      ? admin
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .eq('branch_id', branchId)
          .in('task_status', [...REVIEW_QUEUE_STATUSES])
          .not('assigned_to', 'is', null)
          .in('debtor_id', openIds)
      : Promise.resolve({ count: 0 })

    const [reviewRes, payoutRes, feeReceiptCount, expenseCountRes] = await Promise.all([
      reviewPromise,
      admin
        .from('lawyer_payout_requests')
        .select('id', { count: 'exact', head: true })
        .eq('branch_id', branchId)
        .eq('status', 'pending'),
      countPendingFeeReceipts(admin, branchId),
      admin
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .eq('branch_id', branchId)
        .eq('status', 'pending_approval'),
    ])

    const pendingExpenses = expenseCountRes.count ?? 0
    let pendingExpensesByType: { type: string; count: number }[] = []

    if (pendingExpenses > 0 && pendingExpenses <= 300) {
      const { data: expenseRows } = await admin
        .from('expenses')
        .select('expense_type')
        .eq('branch_id', branchId)
        .eq('status', 'pending_approval')
        .limit(300)
      pendingExpensesByType = groupPendingExpenses(expenseRows ?? [])
    } else if (pendingExpenses > 300) {
      pendingExpensesByType = [{ type: 'صرفيات معلّقة', count: pendingExpenses }]
    }

    return NextResponse.json({
      pendingReview: reviewRes.count ?? 0,
      pendingPayoutRequests: payoutRes.count ?? 0,
      pendingTaskFeeReceipts: feeReceiptCount,
      pendingExpenses,
      pendingExpensesByType,
    }, { headers: CACHE_HEADERS })
  } catch (e) {
    console.error('[admin/notification-counts]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
