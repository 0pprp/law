import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  fetchLawyerWalletBalances,
  fetchLawyerWalletTransactions,
} from '@/lib/lawyer-wallet'

/** Lawyer wallet — service role read so RLS cannot hide balances. */
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

    if (profile?.role !== 'lawyer') {
      return NextResponse.json({ error: 'للمحامين فقط' }, { status: 403 })
    }

    const admin = createAdminClient()
    const [balances, feeTxs, savingsTxs] = await Promise.all([
      fetchLawyerWalletBalances(admin, user.id),
      fetchLawyerWalletTransactions(admin, user.id, 30, 'fees'),
      fetchLawyerWalletTransactions(admin, user.id, 30, 'savings'),
    ])

    return NextResponse.json({ balances, feeTxs, savingsTxs })
  } catch (e) {
    console.error('[lawyer/wallet]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
