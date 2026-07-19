import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { reviewLawyerPayoutRequest } from '@/lib/lawyer-payout-requests'
import {
  canManageFinance,
  apiForbiddenResponse,
  isAccountant,
  isGeneralAccountant,
} from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'
import { logActivity } from '@/lib/activity-log'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const profile = await fetchStaffRoleFields(supabase, user.id)

    if (!profile || !canManageFinance(profile.role)) {
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

    const admin = createAdminClient()

    // محاسب فرعي / موظف: لا يعتمد طلبات خارج فرعه
    const branchScoped = (isAccountant(profile.role) && !isGeneralAccountant(profile.role, profile.accountant_type))
      || profile.role === 'employee'
    if (branchScoped) {
      if (!profile.branch_id) return apiForbiddenResponse()
      const { data: reqRow } = await admin
        .from('lawyer_payout_requests')
        .select('id, branch_id, lawyer_id')
        .eq('id', requestId)
        .maybeSingle()
      if (!reqRow) {
        return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 })
      }
      let reqBranch = reqRow.branch_id as string | null
      if (!reqBranch && reqRow.lawyer_id) {
        const { data: lawyer } = await admin
          .from('profiles')
          .select('branch_id')
          .eq('id', reqRow.lawyer_id)
          .maybeSingle()
        reqBranch = lawyer?.branch_id ?? null
      }
      if (!reqBranch || reqBranch !== profile.branch_id) {
        return apiForbiddenResponse()
      }
    }

    const result = await reviewLawyerPayoutRequest(admin, {
      requestId,
      action,
      reviewerId: user.id,
      reviewNotes: reviewNotes ?? null,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const { data: reqRow } = await admin
      .from('lawyer_payout_requests')
      .select('wallet_kind')
      .eq('id', requestId)
      .maybeSingle()

    const isLegalManagerPayout = (reqRow?.wallet_kind ?? 'fees') === 'legal_manager'

    await logActivity({
      action: action === 'approved'
        ? (isLegalManagerPayout ? 'approve_legal_manager_payout' : 'approve_lawyer_payout_request')
        : (isLegalManagerPayout ? 'reject_legal_manager_payout' : 'reject_lawyer_payout_request'),
      entity_type: isLegalManagerPayout ? 'profile' : 'lawyer',
      entity_id: requestId,
      description: action === 'approved'
        ? (isLegalManagerPayout ? 'اعتماد طلب سحب من محفظة مدير القانونية' : 'اعتماد طلب صرف أتعاب من محامٍ')
        : (isLegalManagerPayout ? 'رفض طلب سحب من محفظة مدير القانونية' : 'رفض طلب صرف أتعاب من محامٍ'),
    }, supabase)

    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    console.error('[admin/payout-request]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
