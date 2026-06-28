import { cn } from '@/lib/utils'
import { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg'
  hover?: boolean
  border?: boolean
}

export function Card({ padding = 'md', hover, border = true, className, children, ...props }: CardProps) {
  const paddings = { none: '', sm: 'p-5', md: 'p-6', lg: 'p-7' }
  return (
    <div
      className={cn(
        'bg-white rounded-xl',
        border && 'border border-[rgba(118,118,118,0.15)]',
        'shadow-sm',
        hover && 'hover:shadow-md hover:border-[rgba(118,118,118,0.25)] transition-all cursor-pointer',
        paddings[padding],
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
  title?: string
  subtitle?: string
  action?: React.ReactNode
}

export function CardHeader({ title, subtitle, action, className, children, ...props }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-6 py-4 border-b border-[rgba(118,118,118,0.1)]', className)} {...props}>
      {(title || subtitle) ? (
        <div className="min-w-0">
          {title && <h3 className="font-bold text-[#231F20] text-base">{title}</h3>}
          {subtitle && <p className="text-sm text-[#454042] mt-1">{subtitle}</p>}
        </div>
      ) : children}
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function CardSection({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('py-5 border-b border-[rgba(118,118,118,0.1)] last:border-0 last:pb-0', className)} {...props}>
      {children}
    </div>
  )
}
