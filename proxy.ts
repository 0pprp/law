import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { UserRole } from '@/lib/types'

export default async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  const isLoginPage = pathname === '/login'
  const isPublicAuthApi = pathname.startsWith('/api/auth/')
  const isApiRoute = pathname.startsWith('/api/')
  const isAdminRoute = pathname.startsWith('/admin')
  const isLawyerRoute = pathname.startsWith('/lawyer')
  const isDelegateRoute = pathname.startsWith('/delegate')

  if (!user && !isLoginPage && !isPublicAuthApi) {
    if (isApiRoute) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isLoginPage) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single()

    if (profile?.is_active === false) {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const role = profile?.role as UserRole
    const dest =
      role === 'lawyer' ? '/lawyer'
      : role === 'delegate' ? '/delegate'
      : '/admin/dashboard'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  if (user && (isAdminRoute || isLawyerRoute || isDelegateRoute || (isApiRoute && !isPublicAuthApi))) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single()

    if (profile?.is_active === false) {
      await supabase.auth.signOut()
      if (isApiRoute) {
        return NextResponse.json({ error: 'الحساب غير فعال' }, { status: 403 })
      }
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const role = profile?.role as UserRole

    if (isLawyerRoute && role !== 'lawyer') {
      const dest = role === 'delegate' ? '/delegate' : '/admin/dashboard'
      return NextResponse.redirect(new URL(dest, request.url))
    }
    if (isDelegateRoute && role !== 'delegate') {
      const dest = role === 'lawyer' ? '/lawyer' : '/admin/dashboard'
      return NextResponse.redirect(new URL(dest, request.url))
    }
    if (isAdminRoute && role === 'lawyer') {
      return NextResponse.redirect(new URL('/lawyer/tasks', request.url))
    }
    if (isAdminRoute && role === 'delegate') {
      return NextResponse.redirect(new URL('/delegate/tasks', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
