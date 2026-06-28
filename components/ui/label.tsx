import { LabelHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean
}

export function Label({ required, className, children, ...props }: LabelProps) {
  return (
    <label className={cn('block text-sm font-semibold text-slate-700 mb-1.5', className)} {...props}>
      {children}
      {required && <span className="text-red-500 mr-0.5">*</span>}
    </label>
  )
}

interface FormFieldProps {
  label?: string
  required?: boolean
  error?: string
  hint?: string
  htmlFor?: string
  children: React.ReactNode
  className?: string
}

export function FormField({ label, required, error, hint, htmlFor, children, className }: FormFieldProps) {
  return (
    <div className={className}>
      {label && <Label htmlFor={htmlFor} required={required}>{label}</Label>}
      {children}
      {hint && !error && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-600 mt-1 font-medium">{error}</p>}
    </div>
  )
}