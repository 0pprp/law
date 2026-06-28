'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

interface Tab {
  key: string
  label: string
  count?: number
  icon?: React.ReactNode
}

interface UrlTabsProps {
  tabs: Tab[]
  paramKey?: string
  className?: string
}

export function UrlTabs({ tabs, paramKey = 'tab', className }: UrlTabsProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeKey = searchParams.get(paramKey) ?? tabs[0]?.key

  return (
    <div className={cn('flex items-center gap-1 border-b border-slate-200 overflow-x-auto scrollbar-hide', className)}>
      {tabs.map(tab => {
        const isActive = tab.key === activeKey
        const params = new URLSearchParams(searchParams.toString())
        params.set(paramKey, tab.key)
        return (
          <Link
            key={tab.key}
            href={`${pathname}?${params.toString()}`}
            className={cn(
              'relative flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors',
              isActive ? 'text-[#EA7300]' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-semibold', isActive ? 'bg-[#EA7300]/15 text-[#EA7300]' : 'bg-slate-100 text-slate-500')}>
                {tab.count}
              </span>
            )}
            {isActive && (
              <span className="absolute bottom-0 inset-x-0 h-0.5 bg-[#EA7300] rounded-t-full" />
            )}
          </Link>
        )
      })}
    </div>
  )
}

interface StaticTabsProps {
  tabs: Tab[]
  activeKey: string
  onChange: (key: string) => void
  className?: string
}

export function StaticTabs({ tabs, activeKey, onChange, className }: StaticTabsProps) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-slate-200 overflow-x-auto', className)}>
      {tabs.map(tab => {
        const isActive = tab.key === activeKey
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              'relative flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors',
              isActive ? 'text-[#EA7300]' : 'text-slate-500 hover:text-slate-800'
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-semibold', isActive ? 'bg-[#EA7300]/15 text-[#EA7300]' : 'bg-slate-100 text-slate-500')}>
                {tab.count}
              </span>
            )}
            {isActive && (
              <span className="absolute bottom-0 inset-x-0 h-0.5 bg-[#EA7300] rounded-t-full" />
            )}
          </button>
        )
      })}
    </div>
  )
}