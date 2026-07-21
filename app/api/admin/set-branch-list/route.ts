import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { BRANCH_COOKIE, BRANCH_COOKIE_ALL, BRANCH_LIST_COOKIE } from '@/lib/branch-context'
import { canReadAllBranches } from '@/lib/permissions'
import { fetchStaffRoleFields } from '@/lib/staff-profile'

const COOKIE_OPTS = {
  httpOnly: false,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
}

/** تعيين أو مسح فلتر القائمة العلوي (مرتبط بفرع الكوكي الحالي). */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const clear = body.clear === true || body.listId === '' || body.listId === 'all' || body.listId == null
    const listId = typeof body.listId === 'string' ? body.listId.trim() : ''

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const profile = await fetchStaffRoleFields(supabase, user.id)
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const cookieStore = await cookies()

    if (clear) {
      cookieStore.set(BRANCH_LIST_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 })
      return NextResponse.json({ ok: true, listId: null, listName: null })
    }

    // تحديد فرع السياق: كوكي الفرع أو فرع المستخدم الثابت
    let branchId: string | null = null
    if (canReadAllBranches(profile.role, profile.accountant_type)) {
      const raw = cookieStore.get(BRANCH_COOKIE)?.value ?? null
      if (raw && raw !== BRANCH_COOKIE_ALL) branchId = raw
    } else {
      branchId = profile.branch_id ?? null
    }

    if (!branchId) {
      return NextResponse.json({ error: 'اختر فرعاً قبل اختيار القائمة' }, { status: 400 })
    }

    const { data: list } = await supabase
      .from('branch_lists')
      .select('id, name, branch_id')
      .eq('id', listId)
      .eq('branch_id', branchId)
      .maybeSingle()

    if (!list) {
      // قائمة غير موجودة / لا تتبع الفرع — امسح الكوكي بأمان
      cookieStore.set(BRANCH_LIST_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 })
      return NextResponse.json({ ok: true, listId: null, listName: null, reset: true })
    }

    cookieStore.set(BRANCH_LIST_COOKIE, list.id, COOKIE_OPTS)
    return NextResponse.json({ ok: true, listId: list.id, listName: list.name })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
