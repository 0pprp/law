import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessFinance } from '@/lib/permissions'
import { getBranchContext } from '@/lib/branch-context'
import {
  fetchLawyerWalletBalances,
  fetchLawyerWalletTransactions,
  fetchLawyerBalancesMap,
  fetchLawyerSavingsBalancesMap,
} from '@/lib/lawyer-wallet'

async function requireFinanceStaff() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'غير مصرح' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !canAccessFinance(profile.role)) {
    return { error: NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 }) }
  }

  return { user, profile }
}

/** Admin finance — service-role wallet reads only. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireFinanceStaff()
    if (auth.error) return auth.error

    const lawyerId = request.nextUrl.searchParams.get('lawyerId')
    const admin = createAdminClient()

    if (lawyerId) {
      const [balances, txs] = await Promise.all([
        fetchLawyerWalletBalances(admin, lawyerId),
        fetchLawyerWalletTransactions(admin, lawyerId, 100),
      ])
      return NextResponse.json({ balances, txs })
    }

    const { branchId } = await getBranchContext()
    let q = admin.from('profiles').select('id').eq('role', 'lawyer').eq('is_active', true)
    if (branchId) q = q.eq('branch_id', branchId)
    const { data: lawyers } = await q
    const ids = (lawyers ?? []).map(l => l.id)

    const [feesMap, savingsMap] = await Promise.all([
      fetchLawyerBalancesMap(admin, ids),
      fetchLawyerSavingsBalancesMap(admin, ids),
    ])

    const balances: Record<string, { fees: number; savings: number }> = {}
    for (const id of ids) {
      balances[id] = {
        fees: feesMap.get(id) ?? 0,
        savings: savingsMap.get(id) ?? 0,
      }
    }

    return NextResponse.json({ balances })
  } catch (e) {
    console.error('[admin/lawyer-wallet GET]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
