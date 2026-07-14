import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { BRANCH_COOKIE, BRANCH_COOKIE_ALL } from '@/lib/branch-context'
import { isMainBranchName } from '@/lib/branch-constants'
import { canReadAllBranches, canUseViewAllBranchesFilter } from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const branchId = body.branchId as string | undefined
    const viewAll = body.viewAll === true || branchId === BRANCH_COOKIE_ALL || branchId === 'all'

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await fetchStaffRoleFields(supabase, user.id)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!canReadAllBranches(profile.role, profile.accountant_type)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const cookieStore = await cookies()

    if (viewAll) {
      if (!canUseViewAllBranchesFilter(profile.role, profile.accountant_type)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      cookieStore.set(BRANCH_COOKIE, BRANCH_COOKIE_ALL, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      })
      return NextResponse.json({ ok: true, branchId: null, branchName: null, viewAll: true })
    }

    if (!branchId || typeof branchId !== 'string') {
      return NextResponse.json({ error: 'branchId required' }, { status: 400 })
    }

    const { data: branch } = await supabase
      .from('branches')
      .select('id, name')
      .eq('id', branchId)
      .eq('is_active', true)
      .single()

    if (!branch) {
      return NextResponse.json({ error: 'Branch not found' }, { status: 404 })
    }

    if (isMainBranchName(branch.name)) {
      return NextResponse.json({ error: 'الفرع الرئيسي غير معتمد — اختر أحد الفروع الرسمية' }, { status: 400 })
    }

    cookieStore.set(BRANCH_COOKIE, branchId, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })

    return NextResponse.json({ ok: true, branchId, branchName: branch.name, viewAll: false })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
