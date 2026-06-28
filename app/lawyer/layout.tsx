import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LawyerNav from '@/components/LawyerNav'

export default async function LawyerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'lawyer') redirect('/admin/dashboard')

  const initials = profile?.full_name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0])
    .join('') ?? 'م'

  return (
    <div className="flex flex-col min-h-screen bg-[#F3F1F2]" dir="rtl">
      {/* Top bar */}
      <header className="bg-[#231F20] text-white px-4 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between sticky top-0 z-40 shadow-lg">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shadow-md shrink-0" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
            <svg className="w-4.5 h-4.5 text-white" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
            </svg>
          </div>
          <div className="leading-none">
            <p className="font-bold text-sm sm:text-base text-white">قلعة الضمان</p>
            <p className="text-white/45 text-xs mt-0.5">البوابة القانونية</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-white/60 text-xs hidden sm:block">{profile?.full_name}</span>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
            {initials}
          </div>
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 pb-20 min-h-0 px-4 sm:px-6 lg:px-8 pt-4">
        <div className="app-content">{children}</div>
      </main>

      {/* Fixed bottom navigation */}
      <LawyerNav />
    </div>
  )
}