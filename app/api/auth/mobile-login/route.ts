import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@supabase/supabase-js'
import { usernameToInternalEmail } from '@/lib/auth-username'
import { NextResponse } from 'next/server'

/**
 * دخول الموبايل (Flutter): نفس اليوزر/كلمة المرور، يُرجع توكنات Supabase
 * بدل تعيين كوكيز الويب.
 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 20
const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const realIp = request.headers.get('x-real-ip')?.trim()
  return forwarded || realIp || 'unknown'
}

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(key)
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return true
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) return false
  entry.count += 1
  return true
}

function authClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(request: Request) {
  try {
    if (!checkRateLimit(clientKey(request))) {
      return NextResponse.json(
        { error: 'محاولات كثيرة. حاول مرة أخرى بعد قليل.' },
        { status: 429 },
      )
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      return NextResponse.json({ error: 'إعدادات الخادم غير مكتملة' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const { username, password } = body as { username?: string; password?: string }
    if (!username || !password) {
      return NextResponse.json({ error: 'بيانات الدخول مطلوبة' }, { status: 400 })
    }

    const trimmed = username.trim().toLowerCase()
    const admin = createAdminClient()
    const supabase = authClient()

    let email = ''
    let profileRow: {
      id: string
      role: string
      is_active: boolean
      username: string | null
      full_name: string | null
      phone: string | null
      branch_id: string | null
      governorate: string | null
    } | null = null

    if (trimmed.includes('@')) {
      email = trimmed
      const { data: signData, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (authError || !signData.session || !signData.user) {
        return NextResponse.json({ error: 'بيانات الدخول غير صحيحة' }, { status: 401 })
      }

      const { data: p } = await admin
        .from('profiles')
        .select('id, role, is_active, username, full_name, phone, branch_id, governorate')
        .eq('id', signData.user.id)
        .single()

      if (!p || p.is_active === false) {
        return NextResponse.json(
          { error: 'الحساب غير فعال، يرجى التواصل مع الإدارة' },
          { status: 403 },
        )
      }
      if (p.role !== 'lawyer') {
        return NextResponse.json({ error: 'تطبيق المحامي للمحامين فقط' }, { status: 403 })
      }

      return NextResponse.json({
        access_token: signData.session.access_token,
        refresh_token: signData.session.refresh_token,
        expires_in: signData.session.expires_in,
        expires_at: signData.session.expires_at,
        token_type: signData.session.token_type ?? 'bearer',
        user: {
          id: signData.user.id,
          email: signData.user.email,
        },
        profile: {
          id: p.id,
          role: p.role,
          username: p.username,
          full_name: p.full_name,
          phone: p.phone,
          branch_id: p.branch_id,
          governorate: p.governorate,
        },
      })
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, role, is_active, username, full_name, phone, branch_id, governorate')
      .eq('username', trimmed)
      .maybeSingle()

    if (profileError) {
      console.error('[mobile-login] profile lookup', profileError.message)
      return NextResponse.json({ error: 'حدث خطأ غير متوقع في الخادم' }, { status: 500 })
    }
    if (!profile) {
      return NextResponse.json({ error: 'اسم المستخدم غير موجود' }, { status: 401 })
    }
    if (!profile.is_active) {
      return NextResponse.json(
        { error: 'الحساب غير فعال، يرجى التواصل مع الإدارة' },
        { status: 403 },
      )
    }
    if (profile.role !== 'lawyer') {
      return NextResponse.json({ error: 'تطبيق المحامي للمحامين فقط' }, { status: 403 })
    }

    profileRow = profile
    const internalEmail = usernameToInternalEmail(trimmed)
    let signResult = await supabase.auth.signInWithPassword({
      email: internalEmail,
      password,
    })

    if (signResult.error) {
      const { data: authUserData } = await admin.auth.admin.getUserById(profile.id)
      const legacyEmail = authUserData?.user?.email
      if (legacyEmail && legacyEmail !== internalEmail) {
        signResult = await supabase.auth.signInWithPassword({ email: legacyEmail, password })
      }
    }

    if (signResult.error || !signResult.data.session || !signResult.data.user) {
      return NextResponse.json({ error: 'كلمة المرور غير صحيحة' }, { status: 401 })
    }

    const session = signResult.data.session
    const user = signResult.data.user

    return NextResponse.json({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      token_type: session.token_type ?? 'bearer',
      user: {
        id: user.id,
        email: user.email,
      },
      profile: {
        id: profileRow.id,
        role: profileRow.role,
        username: profileRow.username,
        full_name: profileRow.full_name,
        phone: profileRow.phone,
        branch_id: profileRow.branch_id,
        governorate: profileRow.governorate,
      },
    })
  } catch (err) {
    console.error('[mobile-login] unhandled exception:', err)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع في الخادم' }, { status: 500 })
  }
}
