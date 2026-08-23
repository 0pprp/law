import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { UserRole } from '@/lib/types'

function homeForRole(role: UserRole | string | undefined): string {
  if (role === 'lawyer') return '/lawyer'
  if (role === 'delegate') return '/delegate'
  if (role === 'payment_follow_up') return '/admin/payment-follow-up'
  if (role === 'chief_accountant') return '/chief-accountant/tasks'
  if (role === 'branch_manager') return '/branch-manager'
  return '/admin/dashboard'
}

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
  const isChiefAccountantRoute = pathname.startsWith('/chief-accountant')
  const isBranchManagerRoute = pathname.startsWith('/branch-manager')

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
    return NextResponse.redirect(new URL(homeForRole(role), request.url))
  }

  if (
    user
    && (isAdminRoute || isLawyerRoute || isDelegateRoute || isChiefAccountantRoute
      || isBranchManagerRoute
      || (isApiRoute && !isPublicAuthApi))
  ) {
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

    if (isBranchManagerRoute && role !== 'branch_manager') {
      return NextResponse.redirect(new URL(homeForRole(role), request.url))
    }
    if (isChiefAccountantRoute && role !== 'chief_accountant') {
      return NextResponse.redirect(new URL(homeForRole(role), request.url))
    }
    if (isLawyerRoute && role !== 'lawyer') {
      return NextResponse.redirect(new URL(homeForRole(role), request.url))
    }
    if (isDelegateRoute && role !== 'delegate') {
      return NextResponse.redirect(new URL(homeForRole(role), request.url))
    }
    if (isAdminRoute && role === 'lawyer') {
      return NextResponse.redirect(new URL('/lawyer/tasks', request.url))
    }
    if (isAdminRoute && role === 'delegate') {
      return NextResponse.redirect(new URL('/delegate/tasks', request.url))
    }
    if (isAdminRoute && role === 'chief_accountant') {
      return NextResponse.redirect(new URL('/chief-accountant/tasks', request.url))
    }
    if (isAdminRoute && role === 'branch_manager') {
      return NextResponse.redirect(new URL('/branch-manager', request.url))
    }
    if (isAdminRoute && role === 'payment_follow_up' && pathname === '/admin/dashboard') {
      return NextResponse.redirect(new URL('/admin/payment-follow-up', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
