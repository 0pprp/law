import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { canManualLegalManagerWalletOps, apiForbiddenResponse } from '@/lib/permissions'
import {
  manualDepositLegalManagerWallet,
  manualWithdrawLegalManagerWallet,
  LEGAL_MANAGER_MANUAL_DEPOSIT_LABEL,
  LEGAL_MANAGER_MANUAL_WITHDRAWAL_LABEL,
} from '@/lib/legal-manager-wallet'
import { logActivity } from '@/lib/activity-log'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, full_name, branch_id')
      .eq('id', user.id)
      .single()

    if (!profile || !canManualLegalManagerWalletOps(profile.role)) {
      return apiForbiddenResponse()
    }

    const body = await request.json().catch(() => ({}))
    const { action, legalManagerUserId, amount, notes } = body as {
      action?: 'deposit' | 'withdraw'
      legalManagerUserId?: string
      amount?: number | string
      notes?: string
    }

    if (!action || !['deposit', 'withdraw'].includes(action)) {
      return NextResponse.json({ error: 'نوع العملية غير صالح' }, { status: 400 })
    }
    if (!legalManagerUserId) {
      return NextResponse.json({ error: 'يجب اختيار مدير القانونية' }, { status: 400 })
    }

    const parsedAmount = typeof amount === 'string' ? parseFloat(amount) : Number(amount)
    if (!parsedAmount || parsedAmount <= 0) {
      return NextResponse.json({ error: 'المبلغ يجب أن يكون أكبر من صفر' }, { status: 400 })
    }
    if (!notes?.trim()) {
      return NextResponse.json({ error: 'الملاحظة مطلوبة' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: targetLm } = await admin
      .from('profiles')
      .select('id, full_name, branch_id, role')
      .eq('id', legalManagerUserId)
      .single()

    if (!targetLm) {
      return NextResponse.json({ error: 'مدير القانونية غير موجود' }, { status: 404 })
    }

    const lmCaseType = targetLm.role === 'criminal_legal_manager' ? 'criminal' : 'civil'

    const params = {
      legalManagerUserId,
      amount: parsedAmount,
      notes: notes.trim(),
      createdBy: user.id,
    }

    const result = action === 'deposit'
      ? await manualDepositLegalManagerWallet(admin, params)
      : await manualWithdrawLegalManagerWallet(admin, params)

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const isDeposit = action === 'deposit'
    await logActivity({
      action: isDeposit ? 'legal_manager_manual_deposit' : 'legal_manager_manual_withdrawal',
      entity_type: 'profile',
      entity_id: legalManagerUserId,
      description: isDeposit ? LEGAL_MANAGER_MANUAL_DEPOSIT_LABEL : LEGAL_MANAGER_MANUAL_WITHDRAWAL_LABEL,
      case_type: lmCaseType,
      metadata: {
        executor_id: user.id,
        executor_name: profile.full_name,
        legal_manager_id: legalManagerUserId,
        legal_manager_name: targetLm.full_name,
        amount: parsedAmount,
        notes: notes.trim(),
        branch_id: targetLm.branch_id ?? profile.branch_id ?? null,
      },
    }, supabase)

    return NextResponse.json({ success: true, newBalance: result.newBalance })
  } catch (e: unknown) {
    console.error('[admin/legal-manager-wallet-manual]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
