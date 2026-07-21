import { NextRequest, NextResponse } from 'next/server'
import { getBranchContext } from '@/lib/branch-context'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isMainBranchName } from '@/lib/branch-constants'
import { usernameToInternalEmail } from '@/lib/auth-username'
import {
  assertLawyerSection,
  normalizeCaseType,
  resolveCaseScope,
  sectionForbiddenResponse,
} from '@/lib/case-scope'
import { isAdmin, isAnyLegalManager, isCriminalLegalManager, isLegalManager } from '@/lib/permissions'
import { logActivity } from '@/lib/activity-log'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles').select('role, case_type').eq('id', user.id).single()
  const callerRole = callerProfile?.role
  if (!isAdmin(callerRole) && !isAnyLegalManager(callerRole)) {
    return NextResponse.json({ error: 'صلاحيات غير كافية' }, { status: 403 })
  }

  const {
    temporary_password, full_name, phone, is_active,
    governorate, identity_number, identity_category,
    username, branch_id: bodyBranchId, role: bodyRole, lawyer_type: bodyLawyerType,
    accountant_type: bodyAccountantType,
    case_type: bodyCaseType,
  } = await request.json()

  const { branchId: cookieBranchId } = await getBranchContext()
  const branchId = bodyBranchId ?? cookieBranchId
  if (!branchId)
    return NextResponse.json({ error: 'يجب اختيار فرع قبل إضافة مستخدم' }, { status: 400 })

  const { data: branchRow } = await supabase.from('branches').select('name').eq('id', branchId).single()
  if (!branchRow || isMainBranchName(branchRow.name))
    return NextResponse.json({ error: 'لا يمكن إضافة مستخدم على الفرع الرئيسي — اختر فرعاً رسمياً' }, { status: 400 })

  const branchGovernorate = branchRow.name

  if (!full_name || !temporary_password || !phone || !String(phone).trim())
    return NextResponse.json({ error: 'الحقول المطلوبة غير مكتملة' }, { status: 400 })
  if (temporary_password.length < 6)
    return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }, { status: 400 })
  if (!username || String(username).trim().length < 3)
    return NextResponse.json({ error: 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل' }, { status: 400 })

  const userRole =
    bodyRole === 'accountant' ? 'accountant'
    : bodyRole === 'viewer' ? 'viewer'
    : bodyRole === 'criminal_legal_manager' ? 'criminal_legal_manager'
    : bodyRole === 'payment_follow_up' ? 'payment_follow_up'
    : 'lawyer'

  if (isLegalManager(callerRole) && userRole !== 'lawyer') {
    return NextResponse.json({ error: 'مسؤول الدعاوى المدنية يمكنه إضافة محامين فقط' }, { status: 403 })
  }
  if (isCriminalLegalManager(callerRole) && userRole !== 'lawyer') {
    return NextResponse.json({ error: 'مسؤول الجزائيات يمكنه إضافة محامين فقط' }, { status: 403 })
  }

  if (userRole === 'payment_follow_up' && !isAdmin(callerRole)) {
    return NextResponse.json({ error: 'إضافة مسؤول متابعة التسديد للمدير فقط' }, { status: 400 })
  }
  if (userRole === 'criminal_legal_manager' && !isAdmin(callerRole)) {
    return NextResponse.json({ error: 'إضافة مسؤول الجزائيات للمدير فقط' }, { status: 403 })
  }
  if (userRole === 'viewer' && !isAdmin(callerRole)) {
    return NextResponse.json({ error: 'إضافة مسؤول الدعاوى المدنية للمدير فقط' }, { status: 403 })
  }

  // قسم المحامي: يُعيَّن عند الإنشاء فقط
  let lawyerCaseType = normalizeCaseType(bodyCaseType)
  if (userRole === 'lawyer') {
    if (isLegalManager(callerRole)) lawyerCaseType = 'civil'
    if (isCriminalLegalManager(callerRole)) lawyerCaseType = 'criminal'
    const callerScope = resolveCaseScope(callerRole)
    if (!assertLawyerSection(callerScope, lawyerCaseType)) {
      return sectionForbiddenResponse()
    }
  }

  if (userRole === 'lawyer') {
    if (!identity_number || !String(identity_number).trim())
      return NextResponse.json({ error: 'رقم الهوية مطلوب' }, { status: 400 })
    if (!identity_category || !String(identity_category).trim())
      return NextResponse.json({ error: 'فئة الهوية مطلوبة' }, { status: 400 })
  }

  const cleanUsername = String(username).trim().toLowerCase()
  if (!/^[a-z0-9._]{3,50}$/.test(cleanUsername))
    return NextResponse.json(
      { error: 'اسم المستخدم: أحرف إنجليزية وأرقام ونقطة وشرطة سفلية فقط' },
      { status: 400 },
    )

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
    user_metadata: { full_name, role: userRole },
  })

  if (authError || !authData.user)
    return NextResponse.json({ error: authError?.message ?? 'فشل إنشاء الحساب' }, { status: 400 })

  const profileUpdate: Record<string, unknown> = {
    username: cleanUsername,
    full_name,
    phone: String(phone).trim(),
    role: userRole,
    is_active: is_active ?? true,
    governorate: governorate || branchGovernorate,
    identity_type: null,
    identity_number: userRole === 'lawyer' ? String(identity_number).trim() : null,
    identity_category: userRole === 'lawyer' ? String(identity_category).trim() : null,
    lawyer_type: userRole === 'lawyer'
      ? (bodyLawyerType === 'general' ? 'general' : 'normal')
      : 'normal',
    accountant_type: userRole === 'accountant'
      ? (bodyAccountantType === 'general' ? 'general' : 'branch')
      : 'branch',
    case_type: userRole === 'lawyer' ? lawyerCaseType : 'civil',
    branch_id: branchId,
  }

  let { error: profileError } = await admin.from('profiles').update(profileUpdate).eq('id', authData.user.id)

  if (profileError && String(profileError.message ?? '').includes('case_type')) {
    const { case_type: _c, ...withoutCase } = profileUpdate
    ;({ error: profileError } = await admin.from('profiles').update(withoutCase).eq('id', authData.user.id))
  }

  if (profileError && String(profileError.message ?? '').includes('accountant_type')) {
    const { accountant_type: _removed, ...withoutAccountantType } = profileUpdate
    ;({ error: profileError } = await admin.from('profiles').update(withoutAccountantType).eq('id', authData.user.id))
    if (profileError) {
      await admin.from('profiles').upsert({ id: authData.user.id, ...withoutAccountantType })
    }
  } else if (profileError) {
    await admin.from('profiles').upsert({ id: authData.user.id, ...profileUpdate })
  }

  await logActivity({
    action: 'create_user',
    entity_type: 'profile',
    entity_id: authData.user.id,
    description: `إنشاء مستخدم: ${full_name} (${userRole})`,
    case_type: userRole === 'lawyer' ? lawyerCaseType : null,
  }, supabase)

  return NextResponse.json({
    success: true,
    lawyerId: authData.user.id,
    role: userRole,
    case_type: userRole === 'lawyer' ? lawyerCaseType : 'civil',
  })
}
