import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import DelegateNav from '@/components/DelegateNav'

export default async function DelegateLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'delegate') {
    redirect(profile?.role === 'lawyer' ? '/lawyer' : '/admin/dashboard')
  }

  const initials = profile?.full_name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0])
    .join('') ?? 'م'

  return (
    <div className="flex flex-col min-h-screen bg-[#F3F1F2]" dir="rtl">
      <header className="bg-[#231F20] text-white px-4 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between sticky top-0 z-40 shadow-lg">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shadow-md shrink-0"
            style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
          >
            <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div className="leading-none">
            <p className="font-bold text-sm sm:text-base text-white">قلعة الضمان</p>
            <p className="text-white/45 text-xs mt-0.5">بوابة المندوب</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/delegate/profile" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
            <span className="text-white/60 text-xs hidden sm:block">{profile?.full_name}</span>
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
              style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
            >
              {initials}
            </div>
          </Link>
        </div>
      </header>

      <main className="flex-1 pb-20 min-h-0 px-4 sm:px-6 lg:px-8 pt-4">
        <div className="app-content">{children}</div>
      </main>

      <DelegateNav />
    </div>
  )
}
