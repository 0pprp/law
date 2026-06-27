import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { submitLawyerPayoutRequest } from '@/lib/lawyer-payout-requests'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, branch_id')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'lawyer') {
      return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const { title, amount, notes } = body as { title?: string; amount?: number | string; notes?: string }

    const parsedAmount = typeof amount === 'string' ? parseFloat(amount) : Number(amount)
    const admin = createAdminClient()
    const result = await submitLawyerPayoutRequest(admin, {
      lawyerId: user.id,
      branchId: profile.branch_id ?? null,
      title: title ?? '',
      amount: parsedAmount,
      notes: notes ?? null,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true, requestId: result.requestId })
  } catch (e: unknown) {
    console.error('[lawyer/payout-request]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
