import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isBranchManager } from '@/lib/permissions'

type Ctx = { params: Promise<{ id: string }> }

/** رفض الترشيح = حذف نهائي بلا سجل نشاط */
export async function POST(_request: NextRequest, context: Ctx) {
  const { id } = await context.params
  if (!id) return NextResponse.json({ error: 'معرّف الطلب مطلوب' }, { status: 400 })

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

  const admin = createAdminClient()

  const { data: nom, error: nomErr } = await admin
    .from('instant_case_nominations')
    .select('id, branch_id, status')
    .eq('id', id)
    .maybeSingle()

  if (nomErr) return NextResponse.json({ error: nomErr.message }, { status: 500 })
  if (!nom) return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 })
  if (nom.branch_id !== profile.branch_id) {
    return NextResponse.json({ error: 'الطلب خارج نطاق فرعك' }, { status: 403 })
  }
  if (nom.status !== 'pending') {
    return NextResponse.json({ error: 'لا يمكن رفض طلب غير معلّق' }, { status: 400 })
  }

  const { error: delErr } = await admin
    .from('instant_case_nominations')
    .delete()
    .eq('id', id)
    .eq('status', 'pending')

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
