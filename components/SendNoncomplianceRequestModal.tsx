'use client'

import { useState } from 'react'

interface Props {
  open: boolean
  debtorId: string
  debtorName: string
  onClose: () => void
  onSuccess: () => void
}

export default function SendNoncomplianceRequestModal({
  open,
  debtorId,
  debtorName,
  onClose,
  onSuccess,
}: Props) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!open) return null

  function resetAndClose() {
    if (saving) return
    setNote('')
    setError('')
    onClose()
  }

  async function confirm() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/payment-noncompliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorId, note: note.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل إرسال الطلب')
        setSaving(false)
        return
      }
      setSaving(false)
      setNote('')
      onSuccess()
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
          <h3 className="text-base font-black text-[#231F20]">إرسال طلب عدم التزام</h3>
          <p className="text-sm text-[#767676] mt-1">
            المدين: <span className="font-bold text-[#231F20]">{debtorName}</span>
          </p>
          <p className="text-xs text-[#767676] mt-2 leading-relaxed">
            سيُرسل الطلب للمدير ومسؤول القانونية لمراجعته. يبقى المدين في جاري التسديد حتى تتم الموافقة.
          </p>
        </div>

        <div>
          <label className="block text-xs font-bold text-[#231F20] mb-1.5">ملاحظة (اختياري)</label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            disabled={saving}
            placeholder="سبب عدم الالتزام أو تفاصيل إضافية..."
            className="w-full text-sm rounded-xl border border-[rgba(118,118,118,0.2)] px-3.5 py-2.5 focus:outline-none focus:border-[#2C8780] disabled:opacity-60 resize-none"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
          >
            {saving ? '...' : 'إرسال الطلب'}
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
