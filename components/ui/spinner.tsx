import { cn } from '@/lib/utils'

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' }

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <svg className={cn('animate-spin', sizes[size], className)} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" className="text-[#2C8780]" />
        <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
      </div>
    </div>
  )
}