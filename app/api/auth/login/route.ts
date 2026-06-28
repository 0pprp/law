import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { usernameToInternalEmail } from '@/lib/auth-username'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    console.log('[login] route hit')
    // ── 0. Env guard ─────────────────────────────────────────────────
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[login] SUPABASE_SERVICE_ROLE_KEY is missing')
      return NextResponse.json({ error: 'مفتاح Service Role غير موجود' }, { status: 500 })
    }

    // ── 1. Parse body ─────────────────────────────────────────────────
    const body = await request.json().catch(() => ({}))
    const { username, password } = body as { username?: string; password?: string }

    if (!username || !password) {
      return NextResponse.json({ error: 'بيانات الدخول مطلوبة' }, { status: 400 })
    }

    const trimmed = username.trim().toLowerCase()
    console.log('[login] username:', trimmed)

    // ── 2. Build clients ──────────────────────────────────────────────
    const admin = createAdminClient()
    const supabase = await createClient()

    let email = ''
    let role = 'lawyer'

    // ── 3. Email fallback (contains @) ────────────────────────────────
    if (trimmed.includes('@')) {
      console.log('[login] using email fallback')
      email = trimmed

      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) {
        console.log('[login] email sign-in failed:', authError.message)

        const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
        const authUser = listed?.users?.find(u => u.email?.toLowerCase() === email)
        if (!authUser) {
          return NextResponse.json(
            {
              error: 'لا يوجد حساب بهذا البريد. سجّل الدخول باسم المستخدم الذي أنشأته الإدارة (مثل: jafar) — وليس بريد Gmail.',
            },
            { status: 401 },
          )
        }

        return NextResponse.json({ error: 'كلمة المرور غير صحيحة' }, { status: 401 })
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

      const redirectTo = role === 'lawyer' ? '/lawyer' : '/admin/dashboard'
      console.log('[login] email fallback success, role:', role)
      return NextResponse.json({ redirectTo })
    }

    // ── 4. Username → profile lookup ──────────────────────────────────
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, role, is_active, username')
      .eq('username', trimmed)
      .maybeSingle()

    console.log('[login] profile found:', !!profile, '| db error:', profileError?.message ?? null)

    if (!profile) {
      return NextResponse.json({ error: 'اسم المستخدم غير موجود' }, { status: 401 })
    }
    if (!profile.is_active) {
      return NextResponse.json(
        { error: 'الحساب غير فعال، يرجى التواصل مع الإدارة' },
        { status: 403 },
      )
    }

    // ── 5. Sign in — internal email for username accounts, then legacy auth email ──
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
      console.log('[login] signInWithPassword failed:', signInError.message)
      return NextResponse.json({ error: 'كلمة المرور غير صحيحة' }, { status: 401 })
    }

    role = profile.role

    // ── 6. Return redirect ────────────────────────────────────────────
    const redirectTo = role === 'lawyer' ? '/lawyer' : '/admin/dashboard'
    console.log('[login] success, role:', role, '→', redirectTo)
    return NextResponse.json({ redirectTo })

  } catch (err) {
    console.error('[login] unhandled exception:', err)
    return NextResponse.json({ error: 'حدث خطأ غير متوقع في الخادم' }, { status: 500 })
  }
}