import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

function DefaultIcon() {
  return (
    <svg className="w-10 h-10 text-[#2C8780]/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 sm:py-20 px-6 text-center', className)}>
      <div className="w-20 h-20 bg-[#2C8780]/8 rounded-2xl flex items-center justify-center mb-5">
        {icon ?? <DefaultIcon />}
      </div>
      <h3 className="text-base font-bold text-[#231F20] mb-1.5">{title}</h3>
      {description && <p className="text-sm text-[#454042] max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}
