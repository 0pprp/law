'use client'

import { ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'link'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: React.ReactNode
  iconEnd?: React.ReactNode
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, iconEnd, fullWidth, children, className, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:pointer-events-none select-none'

    const variants: Record<string, string> = {
      primary: 'bg-gradient-to-r from-[#2C8780] to-[#1D6365] hover:opacity-90 active:opacity-80 text-white focus:ring-[#2C8780]/50 shadow-sm shadow-[#1D6365]/20',
      secondary: 'bg-[#231F20] hover:bg-[#2d2829] active:bg-[#1a1718] text-white focus:ring-[#231F20]/50',
      ghost: 'text-[#454042] hover:bg-[rgba(118,118,118,0.08)] hover:text-[#231F20] active:bg-[rgba(118,118,118,0.12)] focus:ring-[rgba(118,118,118,0.2)]',
      danger: 'text-red-600 hover:bg-red-50 hover:text-red-700 active:bg-red-100 border border-red-200 hover:border-red-300 focus:ring-red-300',
      outline: 'border border-[#2C8780] text-[#2C8780] bg-white hover:bg-[#2C8780]/5 active:bg-[#2C8780]/10 focus:ring-[#2C8780]/30',
      link: 'text-[#2C8780] hover:text-[#1D6365] underline-offset-4 hover:underline focus:ring-[#2C8780]/30 rounded-lg',
    }

    const sizes: Record<string, string> = {
      xs: 'text-xs px-3 py-2 rounded-md gap-1',
      sm: 'text-sm px-3.5 py-2.5 rounded-lg',
      md: 'text-sm px-5 py-3',
      lg: 'text-base px-6 py-3.5',
    }

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : icon}
        {children}
        {!loading && iconEnd}
      </button>
    )
  }
)

Button.displayName = 'Button'
