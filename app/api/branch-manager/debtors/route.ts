import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isBranchManager } from '@/lib/permissions'

/** مدينو فرع مدير الفرع (قراءة + بحث) */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, branch_id, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || profile.is_active === false || !isBranchManager(profile.role)) {
    return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
  }
  if (!profile.branch_id) {
    return NextResponse.json({ error: 'حسابك غير مربوط بفرع' }, { status: 400 })
  }

  const search = request.nextUrl.searchParams.get('q')?.trim() || ''
  const admin = createAdminClient()

  let q = admin
    .from('debtors')
    .select(`
      id, full_name, phone, required_amount, remaining_amount, created_at, case_type,
      branch_list:branch_lists(name)
    `)
    .eq('branch_id', profile.branch_id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (search) {
    const s = search.replace(/[%_,]/g, '')
    q = q.or(`full_name.ilike.%${s}%,phone.ilike.%${s}%`)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ debtors: data ?? [], branch_id: profile.branch_id })
}
