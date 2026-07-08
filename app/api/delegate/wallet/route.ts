import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  fetchDelegateWallet,
  fetchDelegateWalletTransactions,
} from '@/lib/delegate-wallet'

/** Delegate wallet — service role read so RLS cannot hide balances. */
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

    if (profile?.role !== 'delegate') {
      return NextResponse.json({ error: 'للمندوبين فقط' }, { status: 403 })
    }

    const admin = createAdminClient()
    const [balances, transactions] = await Promise.all([
      fetchDelegateWallet(admin, user.id),
      fetchDelegateWalletTransactions(admin, user.id, 50),
    ])

    return NextResponse.json({ balances, transactions })
  } catch (e) {
    console.error('[delegate/wallet]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
