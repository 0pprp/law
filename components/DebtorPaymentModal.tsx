'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseMoneyInput, formatMoney } from '@/lib/money-input'
import MoneyInput from '@/components/ui/money-input'
import CenteredModalPortal from '@/components/ui/centered-modal-portal'
import { fmtMoney } from '@/lib/utils'
import { RECEIPT_NUMBER_LABEL } from '@/lib/ui-labels'
import { newClientRequestId } from '@/lib/client-request-id'

const INP =
  'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white'

interface Props {
  open: boolean
  onClose: () => void
  debtorId: string
  debtorName: string
  receiptNumber: string | null
  remainingAmount: number
  branchId?: string | null
  onSaved?: () => void
}

export default function DebtorPaymentModal({
  open,
  onClose,
  debtorId,
  debtorName,
  receiptNumber,
  remainingAmount,
  branchId,
  onSaved,
}: Props) {
  const router = useRouter()
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const submitLock = useRef(false)
  const requestIdRef = useRef<string | null>(null)

  if (!open) return null

  function handleClose() {
    if (saving || submitLock.current) return
    onClose()
    setAmount('')
    setNotes('')
    setError('')
    setSuccess(false)
    requestIdRef.current = null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving || submitLock.current) return
    const parsed = parseMoneyInput(amount)
    if (!parsed || parsed <= 0) {
      setError('يرجى إدخال مبلغ أكبر من صفر')
      return
    }
    if (parsed > remainingAmount) {
      setError(`المبلغ يتجاوز المتبقي (${fmtMoney(remainingAmount)})`)
      return
    }

    submitLock.current = true
    setSaving(true)
    setError('')
    if (!requestIdRef.current) requestIdRef.current = newClientRequestId()
    const clientRequestId = requestIdRef.current

    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debtorId,
          amount: parsed,
          notes: notes.trim() || null,
          branchId: branchId ?? null,
          clientRequestId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(typeof data.error === 'string' ? data.error : 'فشل تسجيل التسديد')
        setSaving(false)
        submitLock.current = false
        return
      }

      setSaving(false)
      submitLock.current = false
      requestIdRef.current = null
      setSuccess(true)
      onSaved?.()
      router.refresh()
      setTimeout(() => handleClose(), 900)
    } catch {
      setError('فشل تسجيل التسديد')
      setSaving(false)
      submitLock.current = false
    }
  }

  return (
    <CenteredModalPortal onBackdropClick={handleClose} ariaLabelledBy="debtor-payment-modal-title">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
        <h3 id="debtor-payment-modal-title" className="font-bold text-[#231F20] text-lg">
          تسجيل تسديد
        </h3>

        <div className="rounded-xl bg-[#F3F1F2] px-4 py-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-[#767676] shrink-0">المدين</span>
            <span className="font-bold text-[#231F20] text-left">{debtorName}</span>
          </div>
          {receiptNumber && (
            <div className="flex justify-between gap-3">
              <span className="text-[#767676] shrink-0">{RECEIPT_NUMBER_LABEL}</span>
              <span className="font-mono font-semibold text-[#231F20]" dir="ltr">{receiptNumber}</span>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <span className="text-[#767676] shrink-0">المبلغ المتبقي</span>
            <span className="font-bold text-red-600 tabular-nums" dir="ltr">{fmtMoney(remainingAmount)}</span>
          </div>
        </div>

        {success ? (
          <div className="py-6 text-center space-y-2">
            <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-bold text-emerald-700">تم تسجيل التسديد بنجاح</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#767676] mb-1">مبلغ التسديد (د.ع) *</label>
              <MoneyInput
                value={amount}
                onChange={setAmount}
                className={INP}
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#767676] mb-1">ملاحظات</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className={`${INP} resize-none`}
                placeholder="اختياري..."
              />
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
                {saving ? 'جارٍ الحفظ...' : 'تأكيد التسديد'}
              </button>
            </div>
          </form>
        )}
      </div>
    </CenteredModalPortal>
  )
}
