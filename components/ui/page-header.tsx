import { cn } from '@/lib/utils'
import Link from 'next/link'

interface BreadcrumbItem {
  label: string
  href?: string
}

interface PageHeaderProps {
  title: string
  subtitle?: string
  breadcrumb?: BreadcrumbItem[]
  actions?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, breadcrumb, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-5 mb-6 lg:mb-7', className)}>
      <div className="flex-1 min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="flex items-center gap-1.5 text-sm text-[#454042] mb-2.5" aria-label="breadcrumb">
            {breadcrumb.map((item, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-[rgba(118,118,118,0.4)]">/</span>}
                {item.href ? (
                  <Link href={item.href} className="hover:text-[#2C8780] transition-colors font-medium">{item.label}</Link>
                ) : (
                  <span className="text-[#231F20] font-semibold">{item.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl sm:text-2xl font-black text-[#231F20] leading-tight">{title}</h1>
        {subtitle && <p className="text-sm sm:text-base text-[#454042] mt-1.5 font-medium">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {actions}
        </div>
      )}
    </div>
  )
}
