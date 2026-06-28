import { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

const inputBase = 'w-full rounded-xl border border-[rgba(118,118,118,0.22)] bg-white px-4 py-3 text-sm text-[#231F20] font-medium placeholder:text-[#454042] placeholder:font-normal transition-all focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] disabled:opacity-50 disabled:bg-[rgba(118,118,118,0.05)]'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(inputBase, error && 'border-red-400 focus:ring-red-200 focus:border-red-500', className)}
      {...props}
    />
  )
)
Input.displayName = 'Input'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(inputBase, 'resize-none min-h-[5rem]', error && 'border-red-400 focus:ring-red-200 focus:border-red-500', className)}
      {...props}
    />
  )
)
Textarea.displayName = 'Textarea'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, error, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(inputBase, 'cursor-pointer', error && 'border-red-400 focus:ring-red-200 focus:border-red-500', className)}
      {...props}
    >
      {children}
    </select>
  )
)
Select.displayName = 'Select'
