'use client'

import { useEffect, useState } from 'react'
import { parseMoneyInput } from '@/lib/money-input'
import MoneyInput from '@/components/ui/money-input'
import { DatePicker } from '@/components/ui/date-picker'
import CenteredModalPortal from '@/components/ui/centered-modal-portal'
import { localTodayYmd } from '@/lib/local-date'

const INP =
  'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white'

interface ModalProps {
  open: boolean
  onClose: () => void
  debtorId: string
  debtorName: string
  branchId?: string | null
  onSaved?: () => void
}

function DebtorExpenseModal({
  open,
  onClose,
  debtorId,
  debtorName,
  onSaved,
}: ModalProps) {
  const [amount, setAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(localTodayYmd())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    setSuccess(false)
    setAmount('')
    setExpenseDate(localTodayYmd())
  }, [open])

  if (!open) return null

  function handleClose() {
    if (saving) return
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const parsed = parseMoneyInput(amount)
    if (!parsed || parsed <= 0) {
      setError('يرجى إدخال مبلغ أكبر من صفر')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      setError('تاريخ الصرفية غير صالح')
      return
    }

    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debtorId,
          amount: parsed,
          expenseDate,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(typeof data.error === 'string' ? data.error : 'فشل إضافة الصرفية')
        setSaving(false)
        return
      }
      setSaving(false)
      setSuccess(true)
      onSaved?.()
      setTimeout(() => handleClose(), 900)
    } catch {
      setError('فشل الاتصال')
      setSaving(false)
    }
  }

  return (
    <CenteredModalPortal onBackdropClick={handleClose} ariaLabelledBy="debtor-expense-modal-title">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4" dir="rtl">
        <h3 id="debtor-expense-modal-title" className="font-bold text-[#231F20] text-lg">
          إضافة صرفيات
        </h3>

        <div className="rounded-xl bg-[#F3F1F2] px-4 py-3 text-sm flex justify-between gap-3">
          <span className="text-[#767676] shrink-0">المدين</span>
          <span className="font-bold text-[#231F20] text-left">{debtorName}</span>
        </div>

        {success ? (
          <div className="py-6 text-center space-y-2">
            <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-bold text-emerald-700">تمت إضافة الصرفية بنجاح</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#767676] mb-1">المبلغ (د.ع) *</label>
              <MoneyInput value={amount} onChange={setAmount} className={INP} placeholder="0" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#767676] mb-1">التاريخ *</label>
              <DatePicker value={expenseDate} onChange={setExpenseDate} />
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={handleClose}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[#F3F1F2] disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
              >
                {saving ? 'جارٍ الحفظ...' : 'إضافة الصرفية'}
              </button>
            </div>
          </form>
        )}
      </div>
    </CenteredModalPortal>
  )
}

interface ButtonProps {
  debtorId: string
  debtorName: string
  branchId?: string | null
  compact?: boolean
  onSaved?: () => void
}

export default function DebtorAddExpenseButton({
  debtorId,
  debtorName,
  branchId,
  compact = true,
  onSaved,
}: ButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? 'text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap'
            : 'text-sm font-semibold text-[#2C8780] hover:underline'
        }
      >
        إضافة الصرفيات
      </button>
      <DebtorExpenseModal
        open={open}
        onClose={() => setOpen(false)}
        debtorId={debtorId}
        debtorName={debtorName}
        branchId={branchId}
        onSaved={onSaved}
      />
    </>
  )
}
