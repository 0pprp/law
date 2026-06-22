'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

type Tab = { label: string; href: string; exact?: boolean; icon: React.JSX.Element }

const tabs: Tab[] = [
  {
    label: 'الرئيسية',
    href: '/lawyer',
    exact: true,
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    label: 'مهامي',
    href: '/lawyer/tasks',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: 'حسابي',
    href: '/lawyer/account',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      </svg>
    ),
  },
  {
    label: 'ملفي',
    href: '/lawyer/profile',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
]

export default function LawyerNav() {
  const pathname = usePathname()

  function active(href: string, exact?: boolean) {
    return exact ? pathname === href : pathname.startsWith(href)
  }

  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-white border-t border-[rgba(118,118,118,0.12)] z-40 safe-area-bottom"
      dir="rtl"
    >
      <div className="flex items-stretch h-16">
        {tabs.map((tab) => {
          const isActive = active(tab.href, tab.exact)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-semibold transition-all',
                isActive ? 'text-[#2C8780]' : 'text-[#767676]'
              )}
            >
              <span className={cn('transition-transform', isActive && 'scale-110')}>
                {tab.icon}
              </span>
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 w-6 h-0.5 rounded-t-full" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }} />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}