import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireStaffProfile, sessionCaseScope } from '@/lib/api-auth'
import { apiForbiddenResponse, canViewLawyerReports, isAccountant, isGeneralAccountant } from '@/lib/permissions'
import { requireLawyerInScope } from '@/lib/section-guard'
import { fetchLawyerAssignedTasks, type LawyerProfileBrief } from '@/lib/admin-lawyer-stats'
import { fetchLawyerSavingsBalance, fetchLawyerWalletBalance } from '@/lib/lawyer-wallet'

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireStaffProfile()
    if (auth.error) return auth.error
    if (!canViewLawyerReports(auth.profile?.role)) return apiForbiddenResponse()

    const { id: lawyerId } = await ctx.params
    if (!lawyerId) return NextResponse.json({ error: 'معرّف المحامي مطلوب' }, { status: 400 })

    const admin = createAdminClient()
    const scope = sessionCaseScope(auth.profile)
    const gate = await requireLawyerInScope(
      admin,
      scope,
      lawyerId,
      'id, full_name, phone, governorate, branch_id, lawyer_type, case_type, is_active, role',
    )
    if (!gate.ok) return gate.error

    const lawyer = gate.data as LawyerProfileBrief & { role?: string }
    if (lawyer.role && lawyer.role !== 'lawyer') {
      return NextResponse.json({ error: 'المستخدم ليس محامياً' }, { status: 404 })
    }

    let branchName: string | null = null
    if (lawyer.branch_id) {
      const { data: branch } = await admin.from('branches').select('name').eq('id', lawyer.branch_id).maybeSingle()
      branchName = (branch?.name as string | undefined)?.trim() || null
    }

    const profile = auth.profile!
    const branchScoped =
      (isAccountant(profile.role) && !isGeneralAccountant(profile.role, profile.accountant_type))
      || profile.role === 'employee'
    const requestedBranch = request.nextUrl.searchParams.get('branchId')
    const branchId = branchScoped
      ? (profile.branch_id ?? null)
      : (requestedBranch || null)

    if (branchId && lawyer.branch_id && lawyer.branch_id !== branchId) {
      return apiForbiddenResponse()
    }

    const [assigned, savingsBalance, feesBalance] = await Promise.all([
      fetchLawyerAssignedTasks(admin, {
        lawyerId,
        branchId,
      }),
      fetchLawyerSavingsBalance(admin, lawyerId),
      fetchLawyerWalletBalance(admin, lawyerId, 'fees', { viewerRole: profile.role }),
    ])

    return NextResponse.json({
      ok: true,
      lawyer: {
        id: lawyer.id,
        full_name: lawyer.full_name,
        phone: lawyer.phone ?? null,
        governorate: lawyer.governorate ?? null,
        branch_id: lawyer.branch_id ?? null,
        branch_name: branchName,
        lawyer_type: lawyer.lawyer_type ?? null,
        case_type: lawyer.case_type ?? null,
        is_active: lawyer.is_active ?? true,
      } satisfies LawyerProfileBrief,
      assigned,
      balances: {
        savings: savingsBalance,
        fees: feesBalance,
      },
    })
  } catch (e) {
    console.error('[admin/lawyer-workspace]', e)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 })
  }
}
