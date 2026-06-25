'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { cn } from '@/lib/utils'

export interface PremiumSelectOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}

interface PremiumSelectProps {
  value: string
  onChange: (value: string) => void
  options: PremiumSelectOption[]
  placeholder?: string
  disabled?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  headerTitle?: string
  headerSubtitle?: string
  className?: string
  error?: boolean
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={cn('w-3.5 h-3.5 shrink-0 transition-transform duration-200', open && 'rotate-180')}
      fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-[#2C8780] shrink-0" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

export function PremiumSelect({
  value,
  onChange,
  options,
  placeholder = '— اختر —',
  disabled = false,
  searchable = true,
  searchPlaceholder = 'بحث...',
  headerTitle = 'اختر من القائمة',
  headerSubtitle,
  className,
  error,
}: PremiumSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)

  const filtered = useMemo(() => {
    if (!search.trim()) return options
    const q = search.trim().toLowerCase()
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
    )
  }, [options, search])

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open])

  function pick(val: string) {
    onChange(val)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={ref} className={cn('relative', className)} dir="rtl">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        className={cn(
          'group w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border transition-all duration-200 text-right',
          open
            ? 'bg-[#2C8780]/5 border-[#2C8780]/40 ring-2 ring-[#2C8780]/15'
            : 'bg-white border-[rgba(118,118,118,0.18)] hover:border-[#2C8780]/35 hover:shadow-sm',
          error && 'border-red-400 ring-red-100',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <div className={cn(
          'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors',
          open ? 'bg-[#2C8780]/15' : 'bg-[#2C8780]/8 group-hover:bg-[#2C8780]/12',
        )}>
          <svg className="w-3.5 h-3.5 text-[#2C8780]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
          </svg>
        </div>
        <div className="flex-1 min-w-0 text-right">
          <span className={cn('block text-sm truncate', selected ? 'font-bold text-[#231F20]' : 'font-medium text-[#767676]')}>
            {selected?.label ?? placeholder}
          </span>
          {selected?.hint && (
            <span className="block text-[10px] text-[#2C8780] font-semibold mt-0.5 truncate">{selected.hint}</span>
          )}
        </div>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          className="absolute z-[100] left-0 right-0 top-full mt-2 rounded-2xl overflow-hidden"
          style={{
            background: 'white',
            border: '1px solid rgba(118,118,118,0.12)',
            boxShadow: '0 20px 60px -10px rgba(35,31,32,0.18), 0 4px 16px -4px rgba(35,31,32,0.08)',
          }}
        >
          <div
            className="px-4 py-3 flex items-center justify-between gap-2"
            style={{ background: 'linear-gradient(135deg, #2C8780 0%, #1D6365 100%)' }}
          >
            <div className="min-w-0">
              <p className="text-xs font-bold text-white leading-none">{headerTitle}</p>
              {(headerSubtitle ?? options.length > 0) && (
                <p className="text-[10px] text-white/55 mt-0.5">
                  {headerSubtitle ?? `${options.length} خيار متاح`}
                </p>
              )}
            </div>
          </div>

          {searchable && options.length > 4 && (
            <div className="p-3 border-b border-[rgba(118,118,118,0.08)]">
              <div className="relative">
                <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#767676] pointer-events-none" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full pr-9 pl-3 py-2 text-xs rounded-xl border-0 focus:outline-none focus:ring-2 focus:ring-[#2C8780]/20 placeholder:text-[#767676] font-medium bg-[#F3F1F2]"
                  dir="rtl"
                />
              </div>
            </div>
          )}

          <div className="max-h-56 overflow-y-auto overscroll-contain py-1">
            {filtered.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#767676]">لا توجد نتائج</div>
            ) : (
              filtered.map(option => {
                const isActive = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={option.disabled}
                    onClick={() => !option.disabled && pick(option.value)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2.5 text-right transition-all duration-150 relative',
                      isActive
                        ? 'bg-gradient-to-l from-[#2C8780]/10 to-[#2C8780]/4'
                        : 'hover:bg-[#F3F1F2] active:bg-[rgba(118,118,118,0.1)]',
                      option.disabled && 'opacity-40 cursor-not-allowed',
                    )}
                  >
                    {isActive && (
                      <div
                        className="absolute right-0 top-1/2 -translate-y-1/2 w-0.5 h-6 rounded-l"
                        style={{ background: 'linear-gradient(180deg, #2C8780, #1D6365)' }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className={cn('block text-sm leading-tight', isActive ? 'font-bold text-[#2C8780]' : 'font-medium text-[#231F20]')}>
                        {option.label}
                      </span>
                      {option.hint && (
                        <span className="block text-[10px] text-[#767676] mt-0.5">{option.hint}</span>
                      )}
                    </div>
                    {isActive && <CheckIcon />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
