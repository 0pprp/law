'use client'

import { useState } from 'react'
import { PremiumSelect } from '@/components/ui/premium-select'
import {
  PAYMENT_TYPE_OPTIONS,
  PAYMENT_LOCATION_OPTIONS,
  type PaymentScheduleType,
  type PaymentLocation,
} from '@/lib/types'

interface Props {
  open: boolean
  /** الاستخدام المفرد */
  debtorId?: string
  debtorName?: string
  /** الاستخدام الجماعي — عند تمريره تُستخدم المصفوفة بدل debtorId */
  debtorIds?: string[]
  taskId?: string | null
  onClose: () => void
  onSuccess: (summary?: { moved: number; failed: number }) => void
}

export default function MoveToPaymentInProgressModal({
  open,
  debtorId,
  debtorName,
  debtorIds,
  taskId,
  onClose,
  onSuccess,
}: Props) {
  const [paymentType, setPaymentType] = useState<PaymentScheduleType | ''>('')
  const [paymentLocation, setPaymentLocation] = useState<PaymentLocation | ''>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  const bulkIds = (debtorIds ?? []).filter(Boolean)
  const isBulk = bulkIds.length > 0
  const bulkCount = bulkIds.length

  function resetAndClose() {
    if (saving) return
    setPaymentType('')
    setPaymentLocation('')
    setError('')
    onClose()
  }

  async function confirm() {
    if (saving) return
    if (!paymentType) {
      setError('يجب اختيار نوع التسديد')
      return
    }
    if (!paymentLocation) {
      setError('يجب اختيار مكان التسديد')
      return
    }

    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/debtors/to-payment-in-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isBulk
            ? { debtorIds: bulkIds, paymentType, paymentLocation }
            : { debtorId, paymentType, paymentLocation, taskId: taskId || undefined }
        ),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل التحويل')
        setSaving(false)
        return
      }
      setSaving(false)
      setPaymentType('')
      setPaymentLocation('')
      onSuccess(isBulk ? { moved: json.moved ?? 0, failed: json.failed ?? 0 } : undefined)
    } catch {
      setError('فشل الاتصال')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(35,31,32,0.7)', backdropFilter: 'blur(3px)' }}
      dir="rtl"
    >
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-black text-[#231F20]">التحويل إلى جاري التسديد</h3>
          {isBulk ? (
            <p className="text-sm text-[#767676] mt-1">
              سيتم تحويل <span className="font-bold text-[#231F20]">{bulkCount}</span> مدين إلى جاري التسديد
            </p>
          ) : (
            <p className="text-sm text-[#767676] mt-1">
              المدين: <span className="font-bold text-[#231F20]">{debtorName}</span>
            </p>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">
              نوع التسديد <span className="text-red-500">*</span>
            </label>
            <PremiumSelect
              value={paymentType}
              onChange={v => {
                setPaymentType(v === 'daily' || v === 'weekly' || v === 'monthly' ? v : '')
                setError('')
              }}
              options={PAYMENT_TYPE_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
              placeholder="— اختر نوع التسديد —"
              headerTitle="نوع التسديد"
              searchable={false}
              disabled={saving}
              menuPortal
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">
              مكان التسديد <span className="text-red-500">*</span>
            </label>
            <PremiumSelect
              value={paymentLocation}
              onChange={v => {
                setPaymentLocation(v === 'company' || v === 'execution' ? v : '')
                setError('')
              }}
              options={PAYMENT_LOCATION_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
              placeholder="— اختر مكان التسديد —"
              headerTitle="مكان التسديد"
              searchable={false}
              disabled={saving}
              menuPortal
            />
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={saving || !paymentType || !paymentLocation}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
          >
            {saving ? '...' : 'تأكيد'}
          </button>
          <button
            type="button"
            onClick={resetAndClose}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-[#767676] border border-[rgba(118,118,118,0.2)] hover:bg-slate-50 disabled:opacity-50"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  )
}
