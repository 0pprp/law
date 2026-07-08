'use client'

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useMemo,
  type ReactNode,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
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
  /** Small caption above trigger — same as branch selector */
  fieldLabel?: string
  disabled?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  headerTitle?: string
  headerSubtitle?: string
  className?: string
  error?: boolean
  icon?: ReactNode
  /** يعرض القائمة فوق الصفحة — مفيد داخل الجداول ذات overflow */
  menuPortal?: boolean
}

function ChevronIcon({ open, inverted }: { open: boolean; inverted?: boolean }) {
  return (
    <svg
      className={cn(
        'w-3.5 h-3.5 shrink-0 transition-all duration-200',
        open && 'rotate-180',
        inverted ? 'text-white/80' : 'text-[#767676] group-hover:text-[#2C8780]',
      )}
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

function DefaultIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  )
}

const MENU_SURFACE: CSSProperties = {
  background: 'white',
  border: '1px solid rgba(118,118,118,0.12)',
  boxShadow: '0 20px 60px -10px rgba(35,31,32,0.18), 0 4px 16px -4px rgba(35,31,32,0.08)',
}

export function PremiumSelect({
  value,
  onChange,
  options,
  placeholder = '— اختر —',
  fieldLabel,
  disabled = false,
  searchable = true,
  searchPlaceholder = 'بحث...',
  headerTitle = 'اختر من القائمة',
  headerSubtitle,
  className,
  error,
  icon,
  menuPortal = false,
}: PremiumSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
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
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
      setSearch('')
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  useLayoutEffect(() => {
    if (!open || !menuPortal || !triggerRef.current) {
      setMenuStyle(null)
      return
    }

    function updatePosition() {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const estimatedHeight = Math.min(320, 120 + options.length * 44)
      const spaceBelow = window.innerHeight - rect.bottom - 12
      const spaceAbove = rect.top - 12
      const openAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow

      setMenuStyle({
        position: 'fixed',
        left: rect.left,
        width: rect.width,
        zIndex: 9999,
        ...MENU_SURFACE,
        ...(openAbove
          ? { bottom: window.innerHeight - rect.top + 8 }
          : { top: rect.bottom + 8 }),
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, menuPortal, options.length])

  useEffect(() => {
    if (open && searchable) setTimeout(() => searchRef.current?.focus(), 50)
  }, [open, searchable])

  function pick(val: string) {
    onChange(val)
    setOpen(false)
    setSearch('')
  }

  const showSearch = searchable && options.length > 1

  const menuPanel = (
    <div
      ref={menuRef}
      className={cn(
        'rounded-2xl overflow-hidden',
        !menuPortal && 'absolute z-[200] left-0 right-0 top-full mt-2',
      )}
      style={menuPortal ? (menuStyle ?? { ...MENU_SURFACE, visibility: 'hidden' }) : MENU_SURFACE}
    >
      <div
        className="px-4 py-3 flex items-center gap-2"
        style={{ background: 'linear-gradient(135deg, #2C8780 0%, #1D6365 100%)' }}
      >
        <div className="min-w-0">
          <p className="text-xs font-bold text-white leading-none">{headerTitle}</p>
          <p className="text-[10px] text-white/55 mt-0.5">
            {headerSubtitle ?? `${options.length} خيار متاح`}
          </p>
        </div>
      </div>

      {showSearch && (
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
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#767676] hover:text-[#231F20]"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      <div className={cn('py-1', filtered.length > 6 && 'max-h-60 overflow-y-auto overscroll-contain')}>
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#767676]">لا توجد نتائج</div>
        ) : (
          filtered.map(option => {
            const isActive = option.value === value
            return (
              <button
                key={option.value || '__empty__'}
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
  )

  return (
    <div ref={ref} className={cn('relative', className)} dir="rtl">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        className={cn(
          'group w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border transition-all duration-200 text-right select-none',
          open
            ? 'bg-[#2C8780] border-[#1D6365] shadow-lg shadow-[#2C8780]/25 text-white'
            : 'bg-white border-[rgba(118,118,118,0.18)] hover:border-[#2C8780]/40 hover:shadow-sm text-[#231F20]',
          error && !open && 'border-red-400 ring-red-100',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <div className={cn(
          'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200',
          open ? 'bg-white/15' : 'bg-[#2C8780]/8 group-hover:bg-[#2C8780]/12',
        )}>
          {icon ?? (
            <DefaultIcon className={cn('w-3.5 h-3.5', open ? 'text-white' : 'text-[#2C8780]')} />
          )}
        </div>
        <div className="flex-1 min-w-0 text-right">
          {fieldLabel && (
            <span className={cn(
              'block text-[9px] font-bold uppercase tracking-wide leading-none mb-0.5',
              open ? 'text-white/60' : 'text-[#767676]',
            )}>
              {fieldLabel}
            </span>
          )}
          <span className={cn(
            'block text-sm font-bold truncate leading-tight',
            !selected && !open && 'text-[#767676] font-medium',
            open && 'text-white',
          )}>
            {selected?.label ?? placeholder}
          </span>
          {selected?.hint && !open && (
            <span className="block text-[10px] text-[#2C8780] font-semibold mt-0.5 truncate">{selected.hint}</span>
          )}
        </div>
        <ChevronIcon open={open} inverted={open} />
      </button>

      {open && (menuPortal && typeof document !== 'undefined'
        ? createPortal(menuPanel, document.body)
        : menuPanel)}
    </div>
  )
}
