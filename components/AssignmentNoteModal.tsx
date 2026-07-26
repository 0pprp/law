'use client'

import { useState } from 'react'
import type { AwaitingAssignmentDebtor } from '@/lib/awaiting-assignment'

/** نافذة تعديل ملاحظة إسناد المهمة — مشتركة بين كارد تحت إسناد وكارد الأسماء المكررة */
export default function AssignmentNoteModal({
  debtor,
  onClose,
  onSaved,
}: {
  debtor: AwaitingAssignmentDebtor
  onClose: () => void
  onSaved: (note: string | null) => void
}) {
  const [text, setText] = useState(debtor.assignment_note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/admin/debtors/assignment-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorId: debtor.id, note: text }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل حفظ الملاحظة')
        setSaving(false)
        return
      }
      onSaved(typeof json.note === 'string' ? json.note : null)
      onClose()
    } catch {
      setError('فشل الاتصال')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40" dir="rtl">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[#231F20]">ملاحظة إسناد المهمة</h3>
            <p className="text-xs text-[#767676] mt-1">{debtor.full_name}</p>
          </div>
          <button type="button" onClick={onClose} className="text-[#767676] hover:text-[#231F20] text-lg leading-none">×</button>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="سبب التأخير أو أي ملاحظة إدارية... (اتركها فارغة لمسح الملاحظة)"
          className="w-full text-sm rounded-xl border border-[rgba(118,118,118,0.2)] px-3 py-2.5 focus:outline-none focus:border-[#2C8780] resize-none"
        />
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-xl border border-[rgba(118,118,118,0.2)]">
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-xl text-white font-bold bg-[#2C8780] hover:bg-[#1D6365] disabled:opacity-50"
          >
            {saving ? '...' : 'حفظ الملاحظة'}
          </button>
        </div>
      </div>
    </div>
  )
}
