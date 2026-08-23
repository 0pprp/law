import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { canNominateInstantCase, isDelegate } from '@/lib/permissions'
import { isMainBranchName } from '@/lib/branch-constants'

/** إنشاء ترشيح دعوى فورية (مندوب / محاسب فرع) */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, accountant_type, branch_id, governorate, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || profile.is_active === false) {
    return NextResponse.json({ error: 'الحساب غير فعال' }, { status: 403 })
  }
  if (!canNominateInstantCase(profile.role, profile.accountant_type)) {
    return NextResponse.json({ error: 'ليست لديك صلاحية ترشيح الأسماء' }, { status: 403 })
  }
  if (!profile.branch_id) {
    return NextResponse.json({ error: 'حسابك غير مربوط بفرع' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 })
  }

  const debtorName = String(body.debtor_name ?? '').trim()
  const salePrice = Number(body.sale_price)
  const branchListId = String(body.branch_list_id ?? '').trim()

  if (!debtorName) {
    return NextResponse.json({ error: 'اسم المدين مطلوب' }, { status: 400 })
  }
  if (!Number.isFinite(salePrice) || salePrice <= 0) {
    return NextResponse.json({ error: 'سعر البيع يجب أن يكون أكبر من صفر' }, { status: 400 })
  }
  if (!branchListId) {
    return NextResponse.json({ error: 'اختر القائمة' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: branch } = await admin
    .from('branches')
    .select('id, name')
    .eq('id', profile.branch_id)
    .maybeSingle()
  if (!branch || isMainBranchName(branch.name)) {
    return NextResponse.json({ error: 'الفرع غير صالح للترشيح' }, { status: 400 })
  }

  const { data: listOk } = await admin
    .from('branch_lists')
    .select('id')
    .eq('id', branchListId)
    .eq('branch_id', profile.branch_id)
    .maybeSingle()
  if (!listOk) {
    return NextResponse.json({ error: 'القائمة لا تتبع فرعك' }, { status: 400 })
  }

  const governorate =
    (profile.governorate && String(profile.governorate).trim())
    || branch.name

  const nominatorRole = isDelegate(profile.role) ? 'delegate' : 'accountant'

  const { data: row, error } = await admin
    .from('instant_case_nominations')
    .insert({
      branch_id: profile.branch_id,
      branch_list_id: branchListId,
      debtor_name: debtorName,
      sale_price: salePrice,
      governorate,
      nominated_by: user.id,
      nominator_role: nominatorRole,
      status: 'pending',
    })
    .select('id, created_at, status')
    .single()

  if (error || !row) {
    return NextResponse.json({ error: error?.message ?? 'فشل حفظ الترشيح' }, { status: 500 })
  }

  return NextResponse.json({ success: true, nomination: row })
}

/** قائمة ترشيحات المرشِّح الحالي (معلّقة) */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, accountant_type, is_active')
    .eq('id', user.id)
    .single()

  if (!profile || profile.is_active === false) {
    return NextResponse.json({ error: 'الحساب غير فعال' }, { status: 403 })
  }
  if (!canNominateInstantCase(profile.role, profile.accountant_type)) {
    return NextResponse.json({ error: 'ليست لديك صلاحية' }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('instant_case_nominations')
    .select('id, debtor_name, sale_price, status, created_at, branch_list:branch_lists(name)')
    .eq('nominated_by', user.id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ nominations: data ?? [] })
}
