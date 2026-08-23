import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AdminRoleProvider } from '@/context/admin-role'
import type { UserRole } from '@/lib/types'
import BranchManagerLogoutButton from '@/components/BranchManagerLogoutButton'

export default async function BranchManagerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role, branch_id, accountant_type, can_access_civil, can_access_criminal')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'branch_manager') redirect('/admin/dashboard')

  let branchName = ''
  if (profile.branch_id) {
    const { data: branch } = await supabase
      .from('branches')
      .select('name')
      .eq('id', profile.branch_id)
      .maybeSingle()
    branchName = branch?.name ?? ''
  }

  const initials = profile?.full_name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0])
    .join('') ?? 'م'

  return (
    <AdminRoleProvider
      role={(profile.role ?? 'branch_manager') as UserRole}
      accountantType={profile.accountant_type}
      canAccessCivil={profile.can_access_civil}
      canAccessCriminal={profile.can_access_criminal}
    >
    <div className="min-h-screen bg-[#F3F1F2]" dir="rtl">
      <header className="bg-[#231F20] text-white sticky top-0 z-40 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md shrink-0"
              style={{ background: 'linear-gradient(135deg, #b45309, #92400e)' }}
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
            </div>
            <div className="leading-tight min-w-0">
              <p className="font-black text-base sm:text-lg text-white truncate">قلعة الضمان</p>
              <p className="text-white/45 text-xs mt-0.5 truncate">
                مدير الفرع{branchName ? ` — ${branchName}` : ''}
              </p>
            </div>
          </div>

          <nav className="hidden sm:flex items-center gap-1">
            <Link
              href="/branch-manager"
              className="px-3.5 py-2 rounded-lg text-sm font-bold text-white/85 hover:bg-white/10 transition-colors"
            >
              الطلبات
            </Link>
            <Link
              href="/branch-manager/debtors"
              className="px-3.5 py-2 rounded-lg text-sm font-bold text-white/85 hover:bg-white/10 transition-colors"
            >
              مدينو الفرع
            </Link>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-white/60 text-sm hidden md:block max-w-[10rem] truncate">{profile?.full_name}</span>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold"
              style={{ background: 'linear-gradient(135deg, #b45309, #92400e)' }}
            >
              {initials}
            </div>
            <BranchManagerLogoutButton />
          </div>
        </div>
        <div className="sm:hidden border-t border-white/10 px-4 py-2 flex gap-2">
          <Link
            href="/branch-manager"
            className="flex-1 text-center text-xs font-bold py-2 rounded-lg bg-white/10 text-white"
          >
            الطلبات
          </Link>
          <Link
            href="/branch-manager/debtors"
            className="flex-1 text-center text-xs font-bold py-2 rounded-lg text-white/80 hover:bg-white/10"
          >
            مدينو الفرع
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {children}
      </main>
    </div>
    </AdminRoleProvider>
  )
}
