import { cn } from '@/lib/utils'
import Link from 'next/link'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon?: React.ReactNode
  iconBg?: string
  trend?: { value: string; positive?: boolean }
  href?: string
  accent?: 'none' | 'teal' | 'green' | 'red' | 'orange' | 'blue' | 'navy'
  className?: string
}

const accents: Record<string, string> = {
  none:   'border-[rgba(118,118,118,0.15)]',
  teal:   'border-r-2 border-r-[#2C8780] border-[rgba(118,118,118,0.15)]',
  green:  'border-r-2 border-r-emerald-500 border-[rgba(118,118,118,0.15)]',
  red:    'border-r-2 border-r-red-500 border-[rgba(118,118,118,0.15)]',
  orange: 'border-r-2 border-r-[#2C8780] border-[rgba(118,118,118,0.15)]',
  blue:   'border-r-2 border-r-sky-500 border-[rgba(118,118,118,0.15)]',
  navy:   'border-r-2 border-r-[#231F20] border-[rgba(118,118,118,0.15)]',
}

export function StatCard({ label, value, sub, icon, iconBg = 'bg-gradient-to-br from-[#2C8780] to-[#1D6365]', trend, href, accent = 'none', className }: StatCardProps) {
  const content = (
    <div className={cn('bg-white rounded-xl border p-5 shadow-sm transition-all', accents[accent], href && 'hover:shadow-md cursor-pointer', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[#767676] mb-2">{label}</p>
          <p className="text-2xl font-black text-[#231F20] leading-none tabular-nums" dir="ltr">{value}</p>
          {sub && <p className="text-xs text-[#767676] mt-1.5">{sub}</p>}
          {trend && (
            <div className={cn('inline-flex items-center gap-1 mt-2 text-xs font-semibold px-2 py-0.5 rounded-full border', trend.positive ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200')}>
              {trend.positive ? '↑' : '↓'} {trend.value}
            </div>
          )}
        </div>
        {icon && (
          <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shrink-0', iconBg)}>
            {icon}
          </div>
        )}
      </div>
    </div>
  )

  if (href) return <Link href={href}>{content}</Link>
  return content
}