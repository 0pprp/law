import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessFinance, apiForbiddenResponse } from '@/lib/permissions'
import { getBranchContext } from '@/lib/branch-context'
import { fetchLegalManagerWalletBalance } from '@/lib/legal-manager-wallet'

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

    if (!profile || !canAccessFinance(profile.role)) {
      return apiForbiddenResponse()
    }

    const { branchId } = await getBranchContext()
    const admin = createAdminClient()

    let lawyersQ = admin.from('profiles').select('id, full_name, username').eq('role', 'lawyer').eq('is_active', true)
    if (branchId) lawyersQ = lawyersQ.eq('branch_id', branchId)
    const { data: lawyers } = await lawyersQ.order('full_name')

    let lmQ = admin.from('profiles').select('id, full_name, username').eq('role', 'viewer').eq('is_active', true)
    if (branchId) lmQ = lmQ.eq('branch_id', branchId)
    const { data: legalManagers } = await lmQ.order('full_name')

    const list = lawyers ?? []
    const lmList = legalManagers ?? []
    const ids = [...list.map(l => l.id), ...lmList.map(l => l.id)]
    const nameMap = Object.fromEntries([
      ...list.map(l => [l.id, l.full_name]),
      ...lmList.map(l => [l.id, l.full_name]),
    ])

    const legalManagerBalances: Record<string, number> = {}
    await Promise.all(
      lmList.map(async lm => {
        legalManagerBalances[lm.id] = await fetchLegalManagerWalletBalance(admin, lm.id)
      }),
    )

    if (!ids.length) {
      return NextResponse.json({ payouts: [], receipts: [], legalManagerBalances })
    }

    const lawyerIds = list.map(l => l.id)
    const [{ data: payouts }, { data: receipts }] = await Promise.all([
      admin.from('lawyer_payout_requests').select('*').in('lawyer_id', ids).order('created_at', { ascending: false }).limit(200),
      lawyerIds.length
        ? admin.from('task_payment_receipts').select('*, task:tasks(task_type, debtors(full_name))').in('lawyer_id', lawyerIds).order('created_at', { ascending: false }).limit(200)
        : Promise.resolve({ data: [] as never[] }),
    ])

    const profileById = Object.fromEntries([
      ...list.map(l => [l.id, l]),
      ...lmList.map(l => [l.id, l]),
    ])

    return NextResponse.json({
      payouts: (payouts ?? []).map(p => ({
        ...p,
        lawyer: {
          full_name: nameMap[p.lawyer_id] ?? '—',
          username: profileById[p.lawyer_id]?.username ?? null,
        },
      })),
      receipts: (receipts ?? []).map(r => ({
        ...r,
        lawyer: { full_name: nameMap[r.lawyer_id] ?? 'محامٍ' },
      })),
      legalManagerBalances,
    })
  } catch (e) {
    console.error('[admin/finance-requests]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
