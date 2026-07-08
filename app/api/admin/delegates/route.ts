import { NextRequest, NextResponse } from 'next/server'
import { getBranchContext } from '@/lib/branch-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isMainBranchName } from '@/lib/branch-constants'
import { usernameToInternalEmail } from '@/lib/auth-username'
import { canManageDelegates } from '@/lib/permissions'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (!canManageDelegates(callerProfile?.role)) {
    return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
  }

  const {
    temporary_password, full_name, phone, is_active,
    governorate, username, branch_id: bodyBranchId,
  } = await request.json()

  const { branchId: cookieBranchId } = await getBranchContext()
  const branchId = bodyBranchId ?? cookieBranchId
  if (!branchId) {
    return NextResponse.json({ error: 'يجب اختيار فرع قبل إضافة مندوب' }, { status: 400 })
  }

  const { data: branchRow } = await supabase.from('branches').select('name').eq('id', branchId).single()
  if (!branchRow || isMainBranchName(branchRow.name)) {
    return NextResponse.json({ error: 'لا يمكن إضافة مندوب على الفرع الرئيسي — اختر فرعاً رسمياً' }, { status: 400 })
  }

  const branchGovernorate = branchRow.name

  if (!full_name || !temporary_password || !phone || !String(phone).trim()) {
    return NextResponse.json({ error: 'الحقول المطلوبة غير مكتملة' }, { status: 400 })
  }
  if (temporary_password.length < 6) {
    return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }, { status: 400 })
  }
  if (!username || String(username).trim().length < 3) {
    return NextResponse.json({ error: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل' }, { status: 400 })
  }

  const cleanUsername = String(username).trim().toLowerCase()
  if (!/^[a-z0-9._]{3,50}$/.test(cleanUsername)) {
    return NextResponse.json(
      { error: 'اسم المستخدم: أحرف إنجليزية وأرقام ونقطة وشرطة سفلية فقط' },
      { status: 400 },
    )
  }

  const admin = createAdminClient()

  const { data: existingUsername } = await admin
    .from('profiles')
    .select('id')
    .eq('username', cleanUsername)
    .maybeSingle()
  if (existingUsername) {
    return NextResponse.json({ error: 'اسم المستخدم مستخدم مسبقاً' }, { status: 409 })
  }

  const internalEmail = usernameToInternalEmail(cleanUsername)

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: internalEmail,
    password: temporary_password,
    email_confirm: true,
    user_metadata: { full_name, role: 'delegate' },
  })

  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message ?? 'فشل إنشاء الحساب' }, { status: 400 })
  }

  const profileUpdate: Record<string, unknown> = {
    username: cleanUsername,
    full_name,
    phone: String(phone).trim(),
    role: 'delegate',
    is_active: is_active ?? true,
    governorate: governorate || branchGovernorate,
    identity_type: null,
    identity_number: null,
    identity_category: null,
    lawyer_type: 'normal',
    accountant_type: 'branch',
    branch_id: branchId,
  }

  let { error: profileError } = await admin.from('profiles').update(profileUpdate).eq('id', authData.user.id)

  if (profileError && String(profileError.message ?? '').includes('accountant_type')) {
    const { accountant_type: _removed, ...withoutAccountantType } = profileUpdate
    ;({ error: profileError } = await admin.from('profiles').update(withoutAccountantType).eq('id', authData.user.id))
    if (profileError) {
      await admin.from('profiles').upsert({ id: authData.user.id, ...withoutAccountantType })
    }
  } else if (profileError) {
    await admin.from('profiles').upsert({ id: authData.user.id, ...profileUpdate })
  }

  await admin.from('delegate_wallets').upsert(
    { delegate_id: authData.user.id },
    { onConflict: 'delegate_id', ignoreDuplicates: true },
  )

  return NextResponse.json({ success: true, delegateId: authData.user.id, role: 'delegate' })
}
