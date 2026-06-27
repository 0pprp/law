import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reviewLawyerPayoutRequest } from '@/lib/lawyer-payout-requests'
import { logActivity } from '@/lib/activity-log'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, full_name')
      .eq('id', user.id)
      .single()

    if (!profile || !['admin', 'accountant', 'employee'].includes(profile.role)) {
      return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const { requestId, action, reviewNotes } = body as {
      requestId?: string
      action?: 'approved' | 'rejected'
      reviewNotes?: string
    }

    if (!requestId || !action || !['approved', 'rejected'].includes(action)) {
      return NextResponse.json({ error: 'بيانات الطلب غير مكتملة' }, { status: 400 })
    }

    const result = await reviewLawyerPayoutRequest(createAdminClient(), {
      requestId,
      action,
      reviewerId: user.id,
      reviewNotes: reviewNotes ?? null,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    await logActivity({
      action: action === 'approved' ? 'approve_lawyer_payout_request' : 'reject_lawyer_payout_request',
      entity_type: 'lawyer',
      entity_id: requestId,
      description: action === 'approved' ? 'اعتماد طلب صرف أتعاب من محامٍ' : 'رفض طلب صرف أتعاب من محامٍ',
    }, supabase)

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    console.error('[admin/payout-request]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
