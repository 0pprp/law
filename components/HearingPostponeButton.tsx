'use client'

import { useEffect, useState } from 'react'
import CenteredModalPortal from '@/components/ui/centered-modal-portal'
import { DatePicker } from '@/components/ui/date-picker'
import { PremiumSelect } from '@/components/ui/premium-select'
import { fmtDate } from '@/lib/utils'
import { invalidateDashboardCounts } from '@/lib/dashboard-counts-cache'
import type { HearingPostponementRow, PostponeLinkedTaskOption } from '@/lib/hearing-postpone'

const INP =
  'w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] transition-all'

export function HearingPostponeModal({
  open,
  onClose,
  debtorId,
  debtorName,
  currentDate,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  debtorId: string
  debtorName?: string
  currentDate: string | null
  onSuccess: (newDate: string) => void
}) {
  const [newDate, setNewDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasLinked, setHasLinked] = useState(false)
  const [linkedTaskId, setLinkedTaskId] = useState('')
  const [linkedTasks, setLinkedTasks] = useState<PostponeLinkedTaskOption[]>([])
  const [linkedLoading, setLinkedLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setNewDate('')
    setReason('')
    setError('')
    setBusy(false)
    setHasLinked(false)
    setLinkedTaskId('')
    setLinkedTasks([])
  }, [open, debtorId])

  useEffect(() => {
    if (!open || !hasLinked || !debtorId) return
    let cancelled = false
    setLinkedLoading(true)
    fetch(`/api/admin/debtors/${debtorId}/postpone-hearing`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const rows = Array.isArray(data.linkedTasks) ? data.linkedTasks as PostponeLinkedTaskOption[] : []
        setLinkedTasks(rows)
      })
      .catch(() => {
        if (!cancelled) setLinkedTasks([])
      })
      .finally(() => {
        if (!cancelled) setLinkedLoading(false)
      })
    return () => { cancelled = true }
  }, [open, hasLinked, debtorId])

  if (!open) return null

  const canSubmit = Boolean(newDate && reason.trim() && (!hasLinked || linkedTaskId))

  async function submit() {
    if (busy) return
    if (hasLinked && !linkedTaskId) {
      setError('اختر المهمة المرتبطة')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/debtors/${debtorId}/postpone-hearing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newDate,
          reason,
          linkedTaskId: hasLinked ? linkedTaskId : null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'فشل التأجيل')
        setBusy(false)
        return
      }
      onSuccess(String(data.newDate ?? newDate).slice(0, 10))
      invalidateDashboardCounts()
      onClose()
    } catch {
      setError('خطأ في الاتصال')
      setBusy(false)
    }
  }

  return (
    <CenteredModalPortal onBackdropClick={busy ? undefined : onClose} zIndex={90} ariaLabelledBy="postpone-hearing-title">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[min(90vh,640px)] flex flex-col overflow-visible" dir="rtl">
        <div className="px-5 py-4 border-b border-slate-100 shrink-0">
          <h2 id="postpone-hearing-title" className="text-base font-black text-[#231F20]">تأجّلت المرافعة</h2>
          {debtorName && <p className="text-xs text-[#767676] mt-1">{debtorName}</p>}
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0">
          <div>
            <p className="text-[11px] font-bold text-[#767676] mb-1">التاريخ الحالي</p>
            <p className="text-sm font-bold text-[#231F20]" dir="ltr">
              {currentDate ? fmtDate(currentDate) : '—'}
            </p>
          </div>
          <div>
            <label className="text-[11px] font-bold text-[#767676] mb-1 block">التاريخ الجديد</label>
            <DatePicker value={newDate} onChange={setNewDate} placeholder="اختر التاريخ" />
          </div>
          <div>
            <label className="text-[11px] font-bold text-[#767676] mb-1 block">سبب التأجيل</label>
            <textarea
              className={`${INP} min-h-[88px] resize-y`}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="مثال: تأجيل من المحكمة / غياب المدين…"
              maxLength={500}
            />
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hasLinked}
              onChange={e => {
                setHasLinked(e.target.checked)
                if (!e.target.checked) setLinkedTaskId('')
              }}
              className="mt-0.5 w-4 h-4 accent-[#2C8780] shrink-0"
            />
            <span className="text-sm font-bold text-[#231F20]">
              هل يوجد مهمة مرتبطة مع تأجيل المرافعة؟
            </span>
          </label>
          {hasLinked && (
            <div>
              <label className="text-[11px] font-bold text-[#767676] mb-1 block">المهمة المرتبطة</label>
              {linkedLoading ? (
                <p className="text-xs text-[#767676]">جارٍ تحميل المهام…</p>
              ) : linkedTasks.length === 0 ? (
                <p className="text-xs text-amber-700 font-semibold">
                  لا توجد مهام يمكن اختيارها غير إقامة الدعوى
                </p>
              ) : (
                <PremiumSelect
                  value={linkedTaskId}
                  onChange={setLinkedTaskId}
                  options={linkedTasks.map(t => ({
                    value: t.id,
                    label: t.label,
                    hint: t.status_label,
                  }))}
                  placeholder="اختر المهمة المرتبطة"
                  fieldLabel="المهمة المرتبطة"
                  headerTitle="المهمة المرتبطة"
                  searchPlaceholder="بحث بالمهمة..."
                  searchable
                  menuPortal
                />
              )}
            </div>
          )}
          {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-xs font-bold text-[#767676] px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !canSubmit}
            className="text-xs font-bold text-white px-4 py-2 rounded-lg disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg,#B45309,#92400E)' }}
          >
            {busy ? 'جارٍ الحفظ…' : 'تأكيد التأجيل'}
          </button>
        </div>
      </div>
    </CenteredModalPortal>
  )
}

export function HearingPostponeButton({
  debtorId,
  debtorName,
  currentDate,
  onSuccess,
  className,
  compact,
}: {
  debtorId: string
  debtorName?: string
  currentDate: string | null
  onSuccess?: (newDate: string) => void
  className?: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!currentDate}
        title={!currentDate ? 'لا يوجد تاريخ مرافعة' : 'تأجيل تاريخ المرافعة'}
        className={
          className
          ?? (compact
            ? 'text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg shrink-0 hover:bg-amber-100 disabled:opacity-40'
            : 'text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg hover:bg-amber-100 disabled:opacity-40')
        }
      >
        تأجّلت
      </button>
      <HearingPostponeModal
        open={open}
        onClose={() => setOpen(false)}
        debtorId={debtorId}
        debtorName={debtorName}
        currentDate={currentDate}
        onSuccess={date => onSuccess?.(date)}
      />
    </>
  )
}

export function HearingPostponementHistory({
  rows,
  loading,
}: {
  rows: HearingPostponementRow[]
  loading?: boolean
}) {
  if (loading) {
    return <p className="text-[11px] text-[#767676]">جارٍ تحميل سجل التأجيل…</p>
  }
  if (!rows.length) return null

  return (
    <div className="mt-2 space-y-1.5">
      <p className="text-[10px] font-bold text-[#767676]">سجل التأجيل</p>
      {rows.map(r => (
        <div
          key={r.id}
          className="rounded-lg border border-amber-100 bg-amber-50/60 px-2.5 py-2 text-[11px]"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-black text-amber-800">تأجّلت</span>
            <span className="text-[#767676]" dir="ltr">{fmtDate(r.old_date)}</span>
            <span className="text-[#767676]">←</span>
            <span className="font-semibold text-[#231F20]" dir="ltr">{fmtDate(r.new_date)}</span>
          </div>
          <p className="text-[#231F20] mt-0.5">
            <span className="text-[#767676]">السبب:</span> {r.reason}
          </p>
          <p className="text-[#767676] mt-0.5" dir="ltr">
            {fmtDate(r.created_at.split('T')[0])}
            {r.created_by_name ? ` · ${r.created_by_name}` : ''}
          </p>
        </div>
      ))}
    </div>
  )
}
