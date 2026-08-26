import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isBranchManager } from '@/lib/permissions'
import { isMainBranchName } from '@/lib/branch-constants'
import { computeRemainingFromRequired } from '@/lib/debtor-balances'

type Ctx = { params: Promise<{ id: string }> }

/** موافقة مدير الفرع: إنشاء مدين + ربط الترشيح */
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
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (nomErr) return NextResponse.json({ error: nomErr.message }, { status: 500 })
  if (!nom) return NextResponse.json({ error: 'الطلب غير موجود' }, { status: 404 })
  if (nom.branch_id !== profile.branch_id) {
    return NextResponse.json({ error: 'الطلب خارج نطاق فرعك' }, { status: 403 })
  }
  if (nom.status !== 'pending') {
    return NextResponse.json({ error: 'الطلب ليس معلّقاً' }, { status: 400 })
  }

  const { data: branch } = await admin
    .from('branches')
    .select('id, name')
    .eq('id', profile.branch_id)
    .maybeSingle()
  if (!branch || isMainBranchName(branch.name)) {
    return NextResponse.json({ error: 'الفرع غير صالح' }, { status: 400 })
  }

  const salePrice = Number(nom.sale_price)
  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    return NextResponse.json({ error: 'سعر البيع غير صالح' }, { status: 400 })
  }

  const today = new Date().toISOString().split('T')[0]
  const receiptNumber = `فوري-${String(nom.id).replace(/-/g, '').slice(0, 10)}`
  const required = salePrice
  const remaining = computeRemainingFromRequired(required, 0)

  const { data: newDebtor, error: dbError } = await admin
    .from('debtors')
    .insert({
      full_name: String(nom.debtor_name).trim(),
      phone: null,
      governorate: branch.name,
      address: null,
      id_number: null,
      export_date: today,
      receipt_type: 'other',
      receipt_number: receiptNumber,
      receipt_amount: salePrice,
      remaining_amount: remaining,
      required_amount: required,
      lawyer_fees: 0,
      penalty_amount: 0,
      receipt_signed_legal_costs: false,
      notes: 'دعوى فورية — ترشيح معتمد من مدير الفرع',
      created_by: user.id,
      branch_id: profile.branch_id,
      branch_list_id: nom.branch_list_id,
      case_type: 'civil',
    })
    .select('id')
    .single()

  if (dbError || !newDebtor) {
    return NextResponse.json({ error: dbError?.message ?? 'فشل إنشاء المدين' }, { status: 500 })
  }

  const { error: updErr } = await admin
    .from('instant_case_nominations')
    .update({
      status: 'approved',
      debtor_id: newDebtor.id,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')

  if (updErr) {
    await admin.from('debtors').delete().eq('id', newDebtor.id)
    return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, debtor_id: newDebtor.id })
}
