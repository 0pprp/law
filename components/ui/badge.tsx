import { cn } from '@/lib/utils'

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'orange' | 'navy' | 'purple' | 'gray'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
  dot?: boolean
}

const variants: Record<BadgeVariant, string> = {
  default:  'bg-[rgba(118,118,118,0.08)] text-[#454042] border-[rgba(118,118,118,0.2)]',
  success:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning:  'bg-amber-50 text-amber-800 border-amber-200',
  danger:   'bg-red-50 text-red-700 border-red-200',
  info:     'bg-sky-50 text-sky-700 border-sky-200',
  orange:   'bg-[#2C8780]/10 text-[#2C8780] border-[#2C8780]/25',
  navy:     'bg-[#231F20]/8 text-[#231F20] border-[#231F20]/15',
  purple:   'bg-purple-50 text-purple-700 border-purple-200',
  gray:     'bg-gray-50 text-gray-700 border-gray-200',
}

const dotColors: Record<BadgeVariant, string> = {
  default: 'bg-[#454042]',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger:  'bg-red-500',
  info:    'bg-sky-500',
  orange:  'bg-[#2C8780]',
  navy:    'bg-[#231F20]',
  purple:  'bg-purple-500',
  gray:    'bg-gray-400',
}

export function Badge({ variant = 'default', children, className, dot = false }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border', variants[variant], className)}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColors[variant])} />}
      {children}
    </span>
  )
}
