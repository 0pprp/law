import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { BRANCH_COOKIE } from '@/lib/branch-context'
import { isMainBranchName } from '@/lib/branch-constants'

export async function POST(req: Request) {
  try {
    const { branchId } = await req.json()
    if (!branchId || typeof branchId !== 'string') {
      return NextResponse.json({ error: 'branchId required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin' && profile?.role !== 'viewer') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Verify the branch exists
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

    const cookieStore = await cookies()
    cookieStore.set(BRANCH_COOKIE, branchId, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    })

    return NextResponse.json({ ok: true, branchId, branchName: branch.name })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
