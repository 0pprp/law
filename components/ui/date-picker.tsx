'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { cn } from '@/lib/utils'

const TEAL = '#2C8780'
const TEAL_DARK = '#1D6365'

const AR_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
]

const AR_WEEKDAYS = ['أحد', 'إثن', 'ثل', 'أرب', 'خم', 'جم', 'سب']

function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDisplay(ymd: string): string {
  const d = parseYmd(ymd)
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function startWeekday(year: number, month: number): number {
  return new Date(year, month, 1).getDay()
}

interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
  fieldLabel?: string
  headerTitle?: string
  placeholder?: string
  /** أقدم تاريخ مسموح (YYYY-MM-DD) */
  minDate?: string
  /** أحدث تاريخ مسموح (YYYY-MM-DD) */
  maxDate?: string
}

/** منتقي تاريخ واحد — نفس ألوان التطبيق، بدون خطوط النطاق */
export function DatePicker({
  value,
  onChange,
  className,
  disabled = false,
  fieldLabel,
  headerTitle = 'اختر التاريخ',
  placeholder = 'اختر التاريخ',
  minDate,
  maxDate,
}: DatePickerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)

  const initial = value ? parseYmd(value) : new Date()
  const [viewYear, setViewYear] = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())

  useEffect(() => {
    if (open) {
      const base = value ? parseYmd(value) : new Date()
      setViewYear(base.getFullYear())
      setViewMonth(base.getMonth())
    }
  }, [open, value])

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  const todayYmd = useMemo(() => toYmd(new Date()), [open])

  const calendarDays = useMemo(() => {
    const total = daysInMonth(viewYear, viewMonth)
    const start = startWeekday(viewYear, viewMonth)
    const cells: { ymd: string | null; day: number | null }[] = []
    for (let i = 0; i < start; i++) cells.push({ ymd: null, day: null })
    for (let d = 1; d <= total; d++) {
      cells.push({ ymd: toYmd(new Date(viewYear, viewMonth, d)), day: d })
    }
    return cells
  }, [viewYear, viewMonth])

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  function pickDay(ymd: string) {
    if (minDate && ymd < minDate) return
    if (maxDate && ymd > maxDate) return
    onChange(ymd)
    setOpen(false)
  }

  function clearDate() {
    onChange('')
    setOpen(false)
  }

  const displayLabel = value ? formatDisplay(value) : placeholder

  return (
    <div ref={ref} className={cn('relative', className)} dir="rtl">
      {fieldLabel && (
        <span className="block text-xs font-bold text-[#231F20] mb-1">{fieldLabel}</span>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        className={cn(
          'group w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all duration-200 text-right select-none',
          open
            ? 'bg-[#2C8780] border-[#1D6365] shadow-lg shadow-[#2C8780]/25 text-white'
            : 'bg-white border-[rgba(118,118,118,0.18)] hover:border-[#2C8780]/40 hover:shadow-sm text-[#231F20]',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <div className={cn(
          'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all',
          open ? 'bg-white/15' : 'bg-[#2C8780]/8 group-hover:bg-[#2C8780]/12',
        )}>
          <svg className={cn('w-3.5 h-3.5', open ? 'text-white' : 'text-[#2C8780]')} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <span className={cn(
          'flex-1 text-xs font-bold truncate text-right',
          !value && !open && 'text-[#767676] font-medium',
          open && 'text-white',
        )}>
          {displayLabel}
        </span>
        {value && !open ? (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); clearDate() }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); clearDate() } }}
            className="shrink-0 w-6 h-6 rounded-md text-[#767676] hover:bg-[#F3F1F2] hover:text-red-500 flex items-center justify-center text-sm cursor-pointer"
            title="مسح"
          >
            ×
          </span>
        ) : (
          <svg
            className={cn('w-3.5 h-3.5 shrink-0 transition-transform duration-200', open ? 'rotate-180 text-white/80' : 'text-[#767676]')}
            fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {open && (
        <div
          className="absolute z-[200] left-0 right-0 top-full mt-2 rounded-2xl overflow-hidden min-w-[280px]"
          style={{
            background: 'white',
            border: '1px solid rgba(118,118,118,0.12)',
            boxShadow: '0 20px 60px -10px rgba(35,31,32,0.18), 0 4px 16px -4px rgba(35,31,32,0.08)',
          }}
        >
          <div
            className="px-4 py-3"
            style={{ background: `linear-gradient(135deg, ${TEAL} 0%, ${TEAL_DARK} 100%)` }}
          >
            <p className="text-xs font-bold text-white leading-none">{headerTitle}</p>
            {minDate && (
              <p className="text-[10px] text-white/60 mt-1">من {formatDisplay(minDate)} فما بعد</p>
            )}
            {maxDate && (
              <p className="text-[10px] text-white/60 mt-1">حتى {formatDisplay(maxDate)}</p>
            )}
            {value && (
              <p className="text-[10px] text-white/70 mt-0.5">المختار: {formatDisplay(value)}</p>
            )}
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={nextMonth}
                className="w-8 h-8 rounded-lg hover:bg-[#F3F1F2] flex items-center justify-center text-[#231F20]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <p className="text-sm font-bold text-[#231F20]">{AR_MONTHS[viewMonth]} {viewYear}</p>
              <button type="button" onClick={prevMonth}
                className="w-8 h-8 rounded-lg hover:bg-[#F3F1F2] flex items-center justify-center text-[#231F20]">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {AR_WEEKDAYS.map(w => (
                <div key={w} className="text-center text-[10px] font-bold text-[#767676] py-1">{w}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-0.5">
              {calendarDays.map((cell, i) => {
                if (!cell.ymd) return <div key={`e-${i}`} className="h-9" />
                const isSelected = value === cell.ymd
                const isToday = cell.ymd === todayYmd
                const isDisabled = (minDate ? cell.ymd < minDate : false) || (maxDate ? cell.ymd > maxDate : false)
                return (
                  <div key={cell.ymd} className="flex items-center justify-center h-9">
                    <button
                      type="button"
                      disabled={isDisabled}
                      onClick={() => pickDay(cell.ymd!)}
                      className={cn(
                        'w-8 h-8 rounded-full text-xs font-bold transition-all duration-150',
                        isDisabled && 'opacity-25 cursor-not-allowed line-through',
                        isSelected && 'text-white shadow-md',
                        !isSelected && !isDisabled && 'hover:bg-[#2C8780]/15 text-[#231F20]',
                        isToday && !isSelected && 'ring-1 ring-[#2C8780]/40',
                      )}
                      style={isSelected ? { background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})` } : undefined}
                    >
                      {cell.day}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
