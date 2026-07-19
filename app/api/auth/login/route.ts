import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { usernameToInternalEmail } from '@/lib/auth-username'
import { NextResponse } from 'next/server'

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

export async function POST(request: Request) {
  try {
    if (!checkRateLimit(clientKey(request))) {
      return NextResponse.json(
        { error: 'محاولات كثيرة. حاول مرة أخرى بعد قليل.' },
        { status: 429 },
      )
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[login] SUPABASE_SERVICE_ROLE_KEY is missing')
      return NextResponse.json({ error: 'إعدادات الخادم غير مكتملة' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const { username, password } = body as { username?: string; password?: string }

    if (!username || !password) {
      return NextResponse.json({ error: 'بيانات الدخول مطلوبة' }, { status: 400 })
    }

    const trimmed = username.trim().toLowerCase()
    const admin = createAdminClient()
    const supabase = await createClient()

    let email = ''
    let role = 'lawyer'

    if (trimmed.includes('@')) {
      email = trimmed

      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        return NextResponse.json({ error: 'بيانات الدخول غير صحيحة' }, { status: 401 })
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: p } = await admin
          .from('profiles')
          .select('role, is_active')
          .eq('id', user.id)
          .single()

        if (p?.is_active === false) {
          await supabase.auth.signOut()
          return NextResponse.json(
            { error: 'الحساب غير فعال، يرجى التواصل مع الإدارة' },
            { status: 403 },
          )
        }
        role = p?.role ?? 'lawyer'
      }

      const redirectTo =
        role === 'lawyer' ? '/lawyer'
        : role === 'delegate' ? '/delegate'
        : role === 'payment_follow_up' ? '/admin/payment-follow-up'
        : '/admin/dashboard'
      return NextResponse.json({ redirectTo })
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, role, is_active, username')
      .eq('username', trimmed)
      .maybeSingle()

    if (profileError) {
      console.error('[login] profile lookup', profileError.message)
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

    const internalEmail = usernameToInternalEmail(trimmed)
    let signInError = (
      await supabase.auth.signInWithPassword({ email: internalEmail, password })
    ).error

    if (signInError) {
      const { data: authUserData } = await admin.auth.admin.getUserById(profile.id)
      const legacyEmail = authUserData?.user?.email
      if (legacyEmail && legacyEmail !== internalEmail) {
        const retry = await supabase.auth.signInWithPassword({ email: legacyEmail, password })
        signInError = retry.error
      }
    }

    if (signInError) {
      return NextResponse.json({ error: 'كلمة المرور غير صحيحة' }, { status: 401 })
    }

    role = profile.role

    const redirectTo =
      role === 'lawyer' ? '/lawyer'
      : role === 'delegate' ? '/delegate'
      : role === 'payment_follow_up' ? '/admin/payment-follow-up'
      : '/admin/dashboard'
    return NextResponse.json({ redirectTo })

  } catch (err) {
    console.error('[login] unhandled exception:', err)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع في الخادم' }, { status: 500 })
  }
}
