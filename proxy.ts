import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { UserRole } from '@/lib/types'
import { isAccountant } from '@/lib/permissions'

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
  const isAdminRoute = pathname.startsWith('/admin')
  const isLawyerRoute = pathname.startsWith('/lawyer')

  if (!user && !isLoginPage && !isPublicAuthApi) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isLoginPage) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role as UserRole
    const dest = role === 'lawyer' ? '/lawyer' : '/admin/dashboard'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  if (user && (isAdminRoute || isLawyerRoute)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role as UserRole

    if (isLawyerRoute && role !== 'lawyer') {
      return NextResponse.redirect(new URL('/admin/dashboard', request.url))
    }
    if (isAdminRoute && role === 'lawyer') {
      return NextResponse.redirect(new URL('/lawyer/tasks', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
