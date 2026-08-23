import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isBranchManager } from '@/lib/permissions'

type Ctx = { params: Promise<{ id: string }> }

async function requireBranchManagerDebtor(debtorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, response: NextResponse.json({ error: 'غير مصرح' }, { status: 401 }) }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, branch_id, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || profile.is_active === false || !isBranchManager(profile.role)) {
    return { ok: false as const, response: NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 }) }
  }
  if (!profile.branch_id) {
    return { ok: false as const, response: NextResponse.json({ error: 'حسابك غير مربوط بفرع' }, { status: 400 }) }
  }

  const admin = createAdminClient()
  const { data: debtor } = await admin
    .from('debtors')
    .select('id, branch_id')
    .eq('id', debtorId)
    .maybeSingle()

  if (!debtor) {
    return { ok: false as const, response: NextResponse.json({ error: 'المدين غير موجود' }, { status: 404 }) }
  }
  if (debtor.branch_id !== profile.branch_id) {
    return { ok: false as const, response: NextResponse.json({ error: 'خارج نطاق فرعك' }, { status: 403 }) }
  }

  return { ok: true as const, user, admin }
}

export async function GET(_request: NextRequest, context: Ctx) {
  const { id } = await context.params
  const auth = await requireBranchManagerDebtor(id)
  if (!auth.ok) return auth.response

  const { data, error } = await auth.admin
    .from('debtor_notes')
    .select('*, user:profiles!debtor_notes_user_id_fkey(full_name)')
    .eq('debtor_id', id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data ?? [] })
}

export async function POST(request: NextRequest, context: Ctx) {
  const { id } = await context.params
  const auth = await requireBranchManagerDebtor(id)
  if (!auth.ok) return auth.response

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const message = String(body.message ?? '').trim()
  if (!message) return NextResponse.json({ error: 'الملاحظة فارغة' }, { status: 400 })

  const { data: note, error } = await auth.admin
    .from('debtor_notes')
    .insert({
      debtor_id: id,
      user_id: auth.user.id,
      message,
    })
    .select('*, user:profiles!debtor_notes_user_id_fkey(full_name)')
    .single()

  if (error || !note) {
    return NextResponse.json({ error: error?.message ?? 'فشل حفظ الملاحظة' }, { status: 500 })
  }
  return NextResponse.json({ note })
}
