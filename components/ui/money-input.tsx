'use client'

import { formatMoneyInput, parseMoneyInput } from '@/lib/money-input'
import { cn } from '@/lib/utils'

interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string | number
  onChange: (value: string, numeric: number) => void
}

export default function MoneyInput({ value, onChange, className, ...rest }: MoneyInputProps) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      dir="ltr"
      value={formatMoneyInput(value)}
      onChange={e => {
        const numeric = parseMoneyInput(e.target.value)
        onChange(numeric ? String(numeric) : '', numeric)
      }}
      className={cn(className)}
    />
  )
}
