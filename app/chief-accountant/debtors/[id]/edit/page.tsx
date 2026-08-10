'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { BackButton } from '@/components/ui/back-button'
import { Button } from '@/components/ui/button'
import { formInputClass } from '@/components/ui/form-flow'
import MoneyInput from '@/components/ui/money-input'
import { parseMoneyInput } from '@/lib/money-input'
import { RECEIPT_TYPE_LABELS } from '@/lib/types'
import type { ReceiptType } from '@/lib/types'
import { RECEIPT_AMOUNT_LABEL, RECEIPT_NUMBER_LABEL, RECEIPT_TYPE_LABEL } from '@/lib/ui-labels'
import { PremiumSelect } from '@/components/ui/premium-select'
import { uploadDebtorPdfFile } from '@/lib/debtor-file-upload'
import {
  isReceiptNumberMissing,
  normalizeReceiptNumberInput,
  RECEIPT_NUMBER_EMPTY_ERROR,
} from '@/lib/receipt-number'

const FORM_RECEIPT_TYPES: ReceiptType[] = ['check', 'bill_of_exchange', 'trust', 'contract', 'other']

export default function ChiefAccountantEditDebtorPage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isCriminal, setIsCriminal] = useState(false)
  const [pdfFile, setPdfFile] = useState<File | null>(null)

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    address: '',
    id_number: '',
    receipt_type: 'check' as ReceiptType,
    receipt_number: '',
    receipt_amount: '',
    remaining_amount: '',
    lawyer_fees: '',
    penalty_amount: '',
    notes: '',
    court_name: '',
  })

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/admin/debtors/${id}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'فشل التحميل')
        setLoading(false)
        return
      }
      const d = data.debtor
      const criminal = Boolean(d.case_type === 'criminal')
      setIsCriminal(criminal)
      setForm({
        full_name: d.full_name ?? '',
        phone: d.phone ?? '',
        address: d.address ?? '',
        id_number: d.id_number ?? '',
        receipt_type: (d.receipt_type as ReceiptType) || 'check',
        receipt_number: d.receipt_number ?? '',
        receipt_amount: d.receipt_amount != null ? String(d.receipt_amount) : '',
        remaining_amount: d.remaining_amount != null ? String(d.remaining_amount) : '',
        lawyer_fees: d.lawyer_fees != null ? String(d.lawyer_fees) : '',
        penalty_amount: d.penalty_amount != null ? String(d.penalty_amount) : '',
        notes: d.notes ?? '',
        court_name: d.court_name ?? '',
      })
      setLoading(false)
    })()
  }, [id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!form.full_name.trim()) {
      setError('الاسم الكامل مطلوب')
      return
    }
    if (!isCriminal && isReceiptNumberMissing(form.receipt_number)) {
      setError(RECEIPT_NUMBER_EMPTY_ERROR)
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        full_name: form.full_name.trim(),
        notes: form.notes.trim() || null,
        court_name: form.court_name.trim() || null,
      }
      if (!isCriminal) {
        payload.phone = form.phone.trim() || null
        payload.address = form.address.trim() || null
        payload.id_number = form.id_number.trim() || null
        payload.receipt_type = form.receipt_type
        payload.receipt_number = normalizeReceiptNumberInput(form.receipt_number)
        payload.receipt_amount = parseMoneyInput(form.receipt_amount) ?? 0
        payload.remaining_amount = parseMoneyInput(form.remaining_amount) ?? 0
        payload.lawyer_fees = parseMoneyInput(form.lawyer_fees) ?? 0
        payload.penalty_amount = parseMoneyInput(form.penalty_amount) ?? 0
      } else {
        payload.receipt_amount = form.receipt_amount
        payload.criminal_details = { amount_owed: form.receipt_amount }
        payload.address = form.address.trim() || null
      }

      const res = await fetch(`/api/admin/debtors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'فشل الحفظ')
        setSaving(false)
        return
      }

      if (pdfFile) {
        await uploadDebtorPdfFile(id, pdfFile)
        setPdfFile(null)
      }

      setSuccess('تم حفظ التعديلات')
      router.push(`/chief-accountant/debtors/${id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل الحفظ')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-10 h-10 border-2 border-[#0369a1]/30 border-t-[#0369a1] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto space-y-4 pb-10">
      <div className="flex items-center justify-between">
        <BackButton fallback={`/chief-accountant/debtors/${id}`} />
        <Link href={`/chief-accountant/debtors/${id}`} className="text-xs font-bold text-[#0369a1]">
          عرض البروفايل
        </Link>
      </div>

      <h1 className="text-xl font-black text-[#231F20]">تعديل بيانات المدين</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl px-4 py-3">{success}</div>
      )}

      <form onSubmit={e => void handleSubmit(e)} className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] p-4 space-y-4 shadow-sm">
        <div>
          <label className="block text-xs font-bold text-[#454042] mb-1">الاسم الكامل *</label>
          <input
            className={formInputClass}
            value={form.full_name}
            onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
            required
          />
        </div>

        {!isCriminal && (
          <>
            <div>
              <label className="block text-xs font-bold text-[#454042] mb-1">الهاتف</label>
              <input className={formInputClass} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#454042] mb-1">العنوان</label>
              <input className={formInputClass} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#454042] mb-1">رقم الهوية</label>
              <input className={formInputClass} value={form.id_number} onChange={e => setForm(f => ({ ...f, id_number: e.target.value }))} dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#454042] mb-1">{RECEIPT_TYPE_LABEL}</label>
              <PremiumSelect
                value={form.receipt_type}
                onChange={v => setForm(f => ({ ...f, receipt_type: v as ReceiptType }))}
                options={FORM_RECEIPT_TYPES.map(t => ({ value: t, label: RECEIPT_TYPE_LABELS[t] }))}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#454042] mb-1">{RECEIPT_NUMBER_LABEL}</label>
              <input className={formInputClass} value={form.receipt_number} onChange={e => setForm(f => ({ ...f, receipt_number: e.target.value }))} dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#454042] mb-1">{RECEIPT_AMOUNT_LABEL}</label>
              <MoneyInput value={form.receipt_amount} onChange={v => setForm(f => ({ ...f, receipt_amount: v }))} />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#454042] mb-1">المتبقي</label>
              <MoneyInput value={form.remaining_amount} onChange={v => setForm(f => ({ ...f, remaining_amount: v }))} />
            </div>
          </>
        )}

        {isCriminal && (
          <>
            <div>
              <label className="block text-xs font-bold text-[#454042] mb-1">العنوان</label>
              <input className={formInputClass} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-bold text-[#454042] mb-1">المبلغ (نص/رقم)</label>
              <input className={formInputClass} value={form.receipt_amount} onChange={e => setForm(f => ({ ...f, receipt_amount: e.target.value }))} />
            </div>
          </>
        )}

        <div>
          <label className="block text-xs font-bold text-[#454042] mb-1">المحكمة</label>
          <input className={formInputClass} value={form.court_name} onChange={e => setForm(f => ({ ...f, court_name: e.target.value }))} />
        </div>

        <div>
          <label className="block text-xs font-bold text-[#454042] mb-1">ملاحظات</label>
          <textarea
            className={formInputClass}
            rows={3}
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-[#454042] mb-1">رفع مرفق PDF (اختياري)</label>
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={e => setPdfFile(e.target.files?.[0] ?? null)}
            className="block w-full text-xs text-[#454042]"
          />
        </div>

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
        </Button>
      </form>
    </div>
  )
}
