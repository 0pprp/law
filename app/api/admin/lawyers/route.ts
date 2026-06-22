import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'admin')
    return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })

  const {
    email, temporary_password, full_name, phone, is_active,
    governorate, identity_type, identity_number, identity_category,
    username,
  } = await request.json()

  if (!email || !full_name || !temporary_password)
    return NextResponse.json({ error: 'الحقول المطلوبة غير مكتملة' }, { status: 400 })
  if (temporary_password.length < 6)
    return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }, { status: 400 })
  if (!username || String(username).trim().length < 3)
    return NextResponse.json({ error: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل' }, { status: 400 })

  const cleanUsername = String(username).trim().toLowerCase()
  if (!/^[a-z0-9._]{3,50}$/.test(cleanUsername))
    return NextResponse.json(
      { error: 'اسم المستخدم: أحرف إنجليزية وأرقام ونقطة وشرطة سفلية فقط' },
      { status: 400 },
    )

  const admin = createAdminClient()

  // Pre-check username uniqueness
  const { data: existingUsername } = await admin
    .from('profiles')
    .select('id')
    .eq('username', cleanUsername)
    .maybeSingle()
  if (existingUsername) {
    return NextResponse.json({ error: 'اسم المستخدم مستخدم مسبقاً' }, { status: 409 })
  }

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: temporary_password,
    email_confirm: true,
    user_metadata: { full_name, role: 'lawyer' },
  })

  if (authError || !authData.user)
    return NextResponse.json({ error: authError?.message ?? 'فشل إنشاء الحساب' }, { status: 400 })

  const profileUpdate = {
    username: cleanUsername,
    full_name,
    phone: phone || null,
    role: 'lawyer',
    is_active: is_active ?? true,
    governorate: governorate || null,
    identity_type: identity_type || null,
    identity_number: identity_number || null,
    identity_category: identity_category || null,
  }

  const { error: profileError } = await admin.from('profiles').update(profileUpdate).eq('id', authData.user.id)

  if (profileError) {
    await admin.from('profiles').upsert({ id: authData.user.id, ...profileUpdate })
  }

  return NextResponse.json({ success: true, lawyerId: authData.user.id })
}