'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { cn } from '@/lib/utils'

const TABS = [
  { href: '/admin/task-management/civil', label: 'المهام المدنية' },
  { href: '/admin/task-management/criminal', label: 'المهام الجزائية' },
] as const

export default function TaskManagementLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="space-y-5 max-w-5xl">
      <PageHeader
        title="إدارة المهام"
        subtitle="تعريفات المهام المدنية والجزائية — الأتعاب والحقول والصرفيات"
      />
      <div className="flex items-center gap-1 border-b border-[rgba(118,118,118,0.15)]">
        {TABS.map(tab => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'relative px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors',
                active ? 'text-[#2C8780]' : 'text-[#767676] hover:text-[#231F20]',
              )}
            >
              {tab.label}
              {active && (
                <span className="absolute bottom-0 inset-x-0 h-0.5 bg-[#2C8780] rounded-t-full" />
              )}
            </Link>
          )
        })}
      </div>
      {children}
    </div>
  )
}
