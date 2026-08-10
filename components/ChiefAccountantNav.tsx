'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

type Tab = { label: string; href: string; exact?: boolean; icon: React.JSX.Element }

const tabs: Tab[] = [
  {
    label: 'التجهيز',
    href: '/chief-accountant/tasks',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: 'حسابي',
    href: '/chief-accountant/profile',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
]

export default function ChiefAccountantNav() {
  const pathname = usePathname()

  function active(href: string, exact?: boolean) {
    if (exact) return pathname === href
    if (href === '/chief-accountant/tasks') {
      return pathname.startsWith('/chief-accountant/tasks') || pathname.startsWith('/chief-accountant/debtors')
    }
    return pathname.startsWith(href)
  }

  return (
    <nav
      className="fixed bottom-0 inset-x-0 bg-white border-t border-[rgba(118,118,118,0.12)] z-40 safe-area-bottom"
      dir="rtl"
    >
      <div className="flex items-stretch h-[4.25rem] sm:h-[4.5rem]">
        {tabs.map((tab) => {
          const isActive = active(tab.href, tab.exact)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-1.5 text-xs sm:text-sm font-bold transition-all relative',
                isActive ? 'text-[#2C8780]' : 'text-[#767676]',
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
