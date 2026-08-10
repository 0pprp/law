import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function ChiefAccountantLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'chief_accountant') redirect('/admin/dashboard')

  const initials = profile?.full_name
    ?.split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0])
    .join('') ?? 'م'

  return (
    <div className="min-h-screen bg-[#F3F1F2]" dir="rtl">
      <header className="bg-[#231F20] text-white sticky top-0 z-40 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md shrink-0"
              style={{ background: 'linear-gradient(135deg, #0369a1, #0c4a6e)' }}
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75A2.25 2.25 0 016 4.5h4.172a2.25 2.25 0 011.591.659l.828.828A2.25 2.25 0 0014.182 6.75H18a2.25 2.25 0 012.25 2.25v8.25A2.25 2.25 0 0118 19.5H6a2.25 2.25 0 01-2.25-2.25V6.75z" />
              </svg>
            </div>
            <div className="leading-tight min-w-0">
              <p className="font-black text-base sm:text-lg text-white truncate">قلعة الضمان</p>
              <p className="text-white/45 text-xs mt-0.5">المحاسب الرئيسي — تجهيز الملفات</p>
            </div>
          </div>

          <nav className="hidden sm:flex items-center gap-1">
            <Link
              href="/chief-accountant/tasks"
              className="px-3.5 py-2 rounded-lg text-sm font-bold text-white/85 hover:bg-white/10 transition-colors"
            >
              تجهيز الملفات
            </Link>
            <Link
              href="/chief-accountant/profile"
              className="px-3.5 py-2 rounded-lg text-sm font-bold text-white/85 hover:bg-white/10 transition-colors"
            >
              حسابي
            </Link>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-white/60 text-sm hidden md:block max-w-[10rem] truncate">{profile?.full_name}</span>
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold"
              style={{ background: 'linear-gradient(135deg, #0369a1, #0c4a6e)' }}
            >
              {initials}
            </div>
          </div>
        </div>
        <div className="sm:hidden border-t border-white/10 px-4 py-2 flex gap-2">
          <Link
            href="/chief-accountant/tasks"
            className="flex-1 text-center text-xs font-bold py-2 rounded-lg bg-white/10 text-white"
          >
            تجهيز الملفات
          </Link>
          <Link
            href="/chief-accountant/profile"
            className="flex-1 text-center text-xs font-bold py-2 rounded-lg text-white/80 hover:bg-white/10"
          >
            حسابي
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {children}
      </main>
    </div>
  )
}
