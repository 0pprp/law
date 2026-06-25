'use client'

import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

interface FormFlowProps {
  children: ReactNode
  className?: string
}

export function FormFlow({ children, className }: FormFlowProps) {
  return (
    <div className={cn('bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] shadow-[0_8px_30px_rgba(35,31,32,0.06)] overflow-hidden', className)}>
      {children}
    </div>
  )
}

interface FormFlowHeroProps {
  branchName?: string
  meta?: { label: string; value: string }[]
  warning?: string
}

export function FormFlowHero({ branchName, meta, warning }: FormFlowHeroProps) {
  if (warning) {
    return (
      <div className="px-5 py-4 bg-amber-50 border-b border-amber-100 text-amber-900 text-sm">
        {warning}
      </div>
    )
  }

  return (
    <div
      className="px-5 py-4 border-b border-[rgba(118,118,118,0.08)]"
      style={{ background: 'linear-gradient(135deg, rgba(44,135,128,0.08) 0%, rgba(29,99,101,0.04) 100%)' }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <p className="text-[10px] font-bold text-[#2C8780]/70 uppercase tracking-wide">الفرع / المحافظة</p>
            <p className="text-sm font-black text-[#231F20]">{branchName}</p>
          </div>
        </div>
        {meta?.map(item => (
          <div key={item.label} className="h-8 w-px bg-[rgba(118,118,118,0.15)] hidden sm:block" />
        ))}
        {meta?.map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <p className="text-[10px] text-[#767676]">{item.label}</p>
            <p className="text-sm font-bold text-[#231F20]" dir="ltr">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

interface FormFlowStepProps {
  step: number
  title: string
  subtitle?: string
  children: ReactNode
  isLast?: boolean
  icon?: ReactNode
}

export function FormFlowStep({ step, title, subtitle, children, isLast, icon }: FormFlowStepProps) {
  return (
    <div className="relative flex gap-4 px-5 py-5 sm:px-6">
      {/* Timeline connector */}
      <div className="flex flex-col items-center shrink-0 pt-0.5">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-black shadow-sm z-10"
          style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
        >
          {icon ?? step}
        </div>
        {!isLast && (
          <div className="w-0.5 flex-1 min-h-[24px] mt-2 rounded-full bg-gradient-to-b from-[#2C8780]/40 to-[#2C8780]/10" />
        )}
      </div>

      <div className={cn('flex-1 min-w-0 pb-1', !isLast && 'border-b border-[rgba(118,118,118,0.08)]')}>
        <div className="mb-4">
          <h3 className="text-sm font-black text-[#231F20]">{title}</h3>
          {subtitle && <p className="text-xs text-[#767676] mt-0.5 leading-relaxed">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

interface FormFieldProps {
  label: string
  required?: boolean
  hint?: string
  children: ReactNode
  className?: string
}

export function FormField({ label, required, hint, children, className }: FormFieldProps) {
  return (
    <div className={className}>
      <label className="block text-xs font-bold text-[#231F20] mb-1.5">
        {label}{required && <span className="text-red-500 mr-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-[#767676] mt-1">{hint}</p>}
    </div>
  )
}

export const formInputClass =
  'w-full rounded-xl border border-[rgba(118,118,118,0.18)] bg-[#FAFAFA] px-3.5 py-2.5 text-sm text-[#231F20] font-medium placeholder:text-[#767676] placeholder:font-normal transition-all focus:outline-none focus:ring-2 focus:ring-[#2C8780]/20 focus:border-[#2C8780] focus:bg-white'
