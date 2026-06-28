'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
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

function cmpYmd(a: string, b: string): number {
  return a.localeCompare(b)
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

export interface DateRange {
  dateFrom: string
  dateTo: string
}

interface DateRangePickerProps {
  dateFrom: string
  dateTo: string
  onChange: (range: DateRange) => void
  className?: string
  disabled?: boolean
  /** التقارير: فترة التقرير — باقي الصفحات: فترة الفلترة (افتراضي) */
  fieldLabel?: string
  headerTitle?: string
  placeholder?: string
}

type PickPhase = 'start' | 'end'

export function DateRangePicker({
  dateFrom,
  dateTo,
  onChange,
  className,
  disabled = false,
  fieldLabel = 'فترة الفلترة',
  headerTitle = 'اختر فترة الفلترة',
  placeholder = 'اختر فترة الفلترة',
}: DateRangePickerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<PickPhase>('start')
  const [hoverYmd, setHoverYmd] = useState<string | null>(null)
  const [draftFrom, setDraftFrom] = useState(dateFrom)
  const [draftTo, setDraftTo] = useState(dateTo)

  const initial = dateFrom ? parseYmd(dateFrom) : new Date()
  const [viewYear, setViewYear] = useState(initial.getFullYear())
  const [viewMonth, setViewMonth] = useState(initial.getMonth())

  useEffect(() => {
    if (open) {
      setDraftFrom(dateFrom)
      setDraftTo(dateTo)
      setPhase(dateFrom && !dateTo ? 'end' : 'start')
      const base = dateFrom ? parseYmd(dateFrom) : new Date()
      setViewYear(base.getFullYear())
      setViewMonth(base.getMonth())
    }
  }, [open, dateFrom, dateTo])

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setHoverYmd(null)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  const todayYmd = useMemo(() => toYmd(new Date()), [])

  const rangeStart = draftFrom || null
  const rangeEnd = draftTo || (phase === 'end' && hoverYmd && draftFrom && cmpYmd(hoverYmd, draftFrom) >= 0 ? hoverYmd : null)

  const effectiveStart = rangeStart && rangeEnd && cmpYmd(rangeStart, rangeEnd) > 0 ? rangeEnd : rangeStart
  const effectiveEnd = rangeStart && rangeEnd && cmpYmd(rangeStart, rangeEnd) > 0 ? rangeStart : rangeEnd

  const calendarDays = useMemo(() => {
    const total = daysInMonth(viewYear, viewMonth)
    const start = startWeekday(viewYear, viewMonth)
    const cells: { ymd: string | null; day: number | null }[] = []
    for (let i = 0; i < start; i++) cells.push({ ymd: null, day: null })
    for (let d = 1; d <= total; d++) {
      const ymd = toYmd(new Date(viewYear, viewMonth, d))
      cells.push({ ymd, day: d })
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

  const pickDay = useCallback((ymd: string) => {
    if (phase === 'start' || !draftFrom) {
      setDraftFrom(ymd)
      setDraftTo('')
      setPhase('end')
      return
    }
    if (cmpYmd(ymd, draftFrom) < 0) {
      setDraftFrom(ymd)
      setDraftTo('')
      setPhase('end')
      return
    }
    setDraftTo(ymd)
    onChange({ dateFrom: draftFrom, dateTo: ymd })
    setOpen(false)
    setPhase('start')
    setHoverYmd(null)
  }, [phase, draftFrom, onChange])

  function clearRange() {
    setDraftFrom('')
    setDraftTo('')
    setPhase('start')
    onChange({ dateFrom: '', dateTo: '' })
  }

  function applyDraft() {
    if (draftFrom && draftTo) {
      onChange({ dateFrom: draftFrom, dateTo: draftTo })
      setOpen(false)
    } else if (draftFrom) {
      onChange({ dateFrom: draftFrom, dateTo: draftFrom })
      setOpen(false)
    }
  }

  const displayLabel = dateFrom && dateTo
    ? `${formatDisplay(dateFrom)} — ${formatDisplay(dateTo)}`
    : dateFrom
      ? `${formatDisplay(dateFrom)} — اختر تاريخ النهاية`
      : placeholder

  function dayState(ymd: string) {
    const isStart = effectiveStart === ymd
    const isEnd = effectiveEnd === ymd
    const inRange = effectiveStart && effectiveEnd
      && cmpYmd(ymd, effectiveStart) >= 0
      && cmpYmd(ymd, effectiveEnd) <= 0
    const disabledBeforeStart = phase === 'end' && !!draftFrom && cmpYmd(ymd, draftFrom) < 0
    return { isStart, isEnd, inRange, disabledBeforeStart }
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
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <div className={cn(
          'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors',
          open ? 'bg-[#2C8780]/15' : 'bg-[#2C8780]/8 group-hover:bg-[#2C8780]/12',
        )}>
          <svg className="w-3.5 h-3.5 text-[#2C8780]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div className="flex-1 min-w-0 text-right">
          <span className="block text-[10px] text-[#767676] font-semibold mb-0.5">{fieldLabel}</span>
          <span className={cn(
            'block text-sm truncate',
            dateFrom ? 'font-bold text-[#231F20]' : 'font-medium text-[#767676]',
          )}>
            {displayLabel}
          </span>
        </div>
        {(dateFrom || dateTo) && !open ? (
          <span
            role="button"
            tabIndex={0}
            onClick={e => { e.stopPropagation(); clearRange() }}
            onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); clearRange() } }}
            className="shrink-0 w-6 h-6 rounded-md text-[#767676] hover:bg-[#F3F1F2] hover:text-red-500 flex items-center justify-center text-sm cursor-pointer"
            title="مسح"
          >
            ×
          </span>
        ) : (
          <svg
            className={cn('w-3.5 h-3.5 shrink-0 transition-transform duration-200 text-[#767676]', open && 'rotate-180')}
            fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {open && (
        <div
          className="absolute z-[100] left-0 right-0 top-full mt-2 rounded-2xl overflow-hidden min-w-[300px]"
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
            <p className="text-[10px] text-white/60 mt-1">
              {phase === 'start' ? '١ — اختر تاريخ البداية' : '٢ — اختر تاريخ النهاية (لا يمكن أن يكون قبل البداية)'}
            </p>
            {(draftFrom || draftTo) && (
              <div className="flex gap-2 mt-2">
                <span className={cn(
                  'text-[10px] font-bold px-2 py-0.5 rounded-md',
                  phase === 'start' ? 'bg-white/25 text-white' : 'bg-white/10 text-white/70',
                )}>
                  من: {draftFrom ? formatDisplay(draftFrom) : '—'}
                </span>
                <span className={cn(
                  'text-[10px] font-bold px-2 py-0.5 rounded-md',
                  phase === 'end' ? 'bg-white/25 text-white' : 'bg-white/10 text-white/70',
                )}>
                  إلى: {draftTo ? formatDisplay(draftTo) : '—'}
                </span>
              </div>
            )}
          </div>

          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <button type="button" onClick={nextMonth}
                className="w-8 h-8 rounded-lg hover:bg-[#F3F1F2] flex items-center justify-center text-[#231F20] transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              <p className="text-sm font-bold text-[#231F20]">
                {AR_MONTHS[viewMonth]} {viewYear}
              </p>
              <button type="button" onClick={prevMonth}
                className="w-8 h-8 rounded-lg hover:bg-[#F3F1F2] flex items-center justify-center text-[#231F20] transition-colors">
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

                const { isStart, isEnd, inRange, disabledBeforeStart } = dayState(cell.ymd)
                const isToday = cell.ymd === todayYmd
                const isEndpoint = isStart || isEnd

                return (
                  <div key={cell.ymd} className="relative flex items-center justify-center h-9">
                    {inRange && (
                      <div
                        className={cn(
                          'absolute inset-y-1.5 bg-[#2C8780]/14',
                          isStart && !isEnd && 'right-0 left-1 rounded-r-md',
                          isEnd && !isStart && 'left-0 right-1 rounded-l-md',
                          !isStart && !isEnd && 'inset-x-0',
                          isStart && isEnd && 'inset-x-1.5 rounded-full',
                        )}
                      />
                    )}
                    <button
                      type="button"
                      disabled={disabledBeforeStart}
                      onClick={() => !disabledBeforeStart && pickDay(cell.ymd!)}
                      onMouseEnter={() => phase === 'end' && draftFrom && setHoverYmd(cell.ymd)}
                      onMouseLeave={() => setHoverYmd(null)}
                      className={cn(
                        'relative z-10 w-8 h-8 rounded-full text-xs font-bold transition-all duration-150',
                        disabledBeforeStart && 'opacity-25 cursor-not-allowed line-through',
                        isEndpoint && 'text-white shadow-md',
                        !isEndpoint && !disabledBeforeStart && 'hover:bg-[#2C8780]/15 text-[#231F20]',
                        !isEndpoint && inRange && 'text-[#2C8780] font-bold',
                        isToday && !isEndpoint && 'ring-1 ring-[#2C8780]/40',
                      )}
                      style={isEndpoint ? { background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})` } : undefined}
                    >
                      {cell.day}
                    </button>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t border-[rgba(118,118,118,0.1)]">
              <button
                type="button"
                onClick={clearRange}
                className="text-xs font-semibold text-[#767676] hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
              >
                مسح الكل
              </button>
              <button
                type="button"
                onClick={applyDraft}
                disabled={!draftFrom}
                className="text-xs font-bold text-white px-4 py-2 rounded-lg disabled:opacity-40 transition-opacity"
                style={{ background: `linear-gradient(135deg, ${TEAL}, ${TEAL_DARK})` }}
              >
                {draftTo ? 'تطبيق' : draftFrom ? 'يوم واحد' : 'تطبيق'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
