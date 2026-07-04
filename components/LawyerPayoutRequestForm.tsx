'use client'

import { useState } from 'react'
import { fmtMoney } from '@/lib/utils'
import { parseMoneyInput } from '@/lib/money-input'
import MoneyInput from '@/components/ui/money-input'
import { RECEIPT_STATUS_LABELS } from '@/lib/types'
import type { LawyerWalletKind } from '@/lib/types'
import type { LawyerPayoutRequest } from '@/lib/lawyer-payout-requests'

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
}

interface Props {
  availableBalance: number
  requests: LawyerPayoutRequest[]
  onSubmitted: () => void
  walletKind?: LawyerWalletKind
  submitUrl?: string
  formTitle?: string
  formHint?: string
  submitButtonLabel?: string
  requestsSectionTitle?: string
  showTitleField?: boolean
}

const INP = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white'

export default function LawyerPayoutRequestForm({
  availableBalance,
  requests,
  onSubmitted,
  walletKind = 'fees',
  submitUrl = '/api/lawyer/payout-request',
  formTitle = 'طلب صرف أتعاب',
  formHint = 'يُرسل للإدارة للموافقة أو الرفض',
  submitButtonLabel = 'إرسال الطلب للإدارة',
  requestsSectionTitle = 'طلبات الصرف',
  showTitleField = true,
}: Props) {
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const filteredRequests = requests.filter(r => (r.wallet_kind ?? 'fees') === walletKind)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    const parsed = parseMoneyInput(amount)
    const resolvedTitle = showTitleField ? title.trim() : (title.trim() || 'طلب سحب')
    if (showTitleField && !resolvedTitle) { setError('أدخل اسم الطلب'); return }
    if (!parsed || parsed <= 0) { setError('أدخل مبلغاً صحيحاً'); return }
    if (parsed > availableBalance) {
      setError(`المبلغ يتجاوز الرصيد المتاح (${fmtMoney(availableBalance)})`)
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        title: resolvedTitle,
        amount: parsed,
        notes: notes.trim() || null,
      }
      if (walletKind !== 'fees') body.walletKind = walletKind

      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        const msg = String(data.error ?? '')
        setError(
          msg.includes('row-level security')
            ? 'تعذر إرسال الطلب حالياً — أعد المحاولة أو تواصل مع الإدارة'
            : (data.error ?? 'فشل إرسال الطلب'),
        )
        setSaving(false)
        return
      }
      setTitle('')
      setAmount('')
      setNotes('')
      setSuccess('تم إرسال الطلب للإدارة — بانتظار الموافقة')
      onSubmitted()
    } catch {
      setError('حدث خطأ في الاتصال')
    }
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-[#2C8780]/25 shadow-sm p-4">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <p className="text-xs font-bold text-slate-500">{formTitle}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{formHint}</p>
          </div>
          <div className="text-left shrink-0">
            <p className="text-[10px] text-slate-400">الرصيد المتاح</p>
            <p className="text-sm font-black text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(availableBalance)}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {showTitleField && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">اسم الطلب *</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="مثال: صرف أتعاب شهر حزيران" className={INP} maxLength={120} />
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">المبلغ (د.ع) *</label>
            <MoneyInput value={amount} onChange={v => setAmount(v)} placeholder="0" className={INP} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">ملاحظات (اختياري)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="تفاصيل إضافية..." className={INP} />
          </div>
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          {success && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{success}</p>}
          <button
            type="submit"
            disabled={saving || availableBalance <= 0}
            className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #2C8780, #1D6365)' }}
          >
            {saving ? 'جارٍ الإرسال...' : submitButtonLabel}
          </button>
        </form>
      </div>

      {filteredRequests.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b border-slate-100">
            <p className="text-xs font-bold text-slate-400">{requestsSectionTitle}</p>
          </div>
          <div className="divide-y divide-slate-100">
            {filteredRequests.map(req => (
              <div key={req.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{req.title}</p>
                    <p className="text-sm font-black text-[#2C8780] tabular-nums mt-0.5" dir="ltr">{fmtMoney(Number(req.amount))}</p>
                    {req.review_notes && (
                      <p className="text-[10px] text-red-600 mt-1">ملاحظة الإدارة: {req.review_notes}</p>
                    )}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLE[req.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {RECEIPT_STATUS_LABELS[req.status]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
