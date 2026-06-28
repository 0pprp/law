'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity-log'
import { localTodayYmd } from '@/lib/local-date'
import type { TaskDefinitionExpense } from '@/lib/task-definition-expenses'

const INP = 'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/25 focus:border-sky-500 transition-all'

const MAX_ERROR = 'لا يمكن أن يتجاوز مبلغ الصرفية الحد الأعلى المحدد لهذه المهمة'

interface Props {
  task: {
    id: string
    debtor_id: string
    case_id?: string | null
    branch_id?: string | null
  }
  expenseDefs: TaskDefinitionExpense[]
  onClose: () => void
  onConfirmed: () => void
}

export default function TaskCompletionExpenseModal({ task, expenseDefs, onClose, onConfirmed }: Props) {
  const [rows, setRows] = useState(() =>
    expenseDefs.map(def => ({ defId: def.id, amount: '', note: '' })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function setAmount(idx: number, val: string) {
    if (val !== '' && !/^\d+$/.test(val)) return
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, amount: val } : r)))
    setError('')
  }

  function setNote(idx: number, val: string) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, note: val } : r)))
    setError('')
  }

  function validate(): string | null {
    for (let i = 0; i < expenseDefs.length; i++) {
      const def = expenseDefs[i]
      const row = rows[i]
      const label = def.name

      if (!row.amount.trim()) return `يجب إدخال مبلغ: ${label}`
      const amt = Number(row.amount)
      if (isNaN(amt) || amt <= 0) return `مبلغ غير صالح: ${label}`
      if (amt > def.max_amount) return MAX_ERROR
      if (!row.note.trim()) return `يجب إدخال ملاحظة: ${label}`
    }
    return null
  }

  async function handleConfirm() {
    const err = validate()
    if (err) { setError(err); return }

    setSaving(true)
    setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('يرجى تسجيل الدخول'); setSaving(false); return }

    await supabase
      .from('expenses')
      .delete()
      .eq('task_id', task.id)
      .in('status', ['pending_review', 'pending_approval', 'pending'])

    const today = localTodayYmd()
    const inserts = expenseDefs.map((def, i) => {
      const row = rows[i]
      const payload: Record<string, unknown> = {
        debtor_id: task.debtor_id,
        task_id: task.id,
        case_id: task.case_id ?? null,
        branch_id: task.branch_id ?? null,
        lawyer_id: user.id,
        amount: Number(row.amount),
        expense_type: def.name,
        description: row.note.trim(),
        expense_date: today,
        created_by: user.id,
        status: 'pending_review',
        max_allowed_amount: def.max_amount,
        task_definition_expense_id: def.id,
      }
      return payload
    })

    const { error: insertErr } = await supabase.from('expenses').insert(inserts as any)
    if (insertErr) {
      setError(insertErr.message)
      setSaving(false)
      return
    }

    const total = inserts.reduce((s, e) => s + Number(e.amount), 0)
    await logActivity({
      action: 'submit_task_expenses',
      entity_type: 'task',
      entity_id: task.id,
      description: `تسجيل صرفيات المهمة (${inserts.length}) — ${total.toLocaleString('en-US')} د.ع`,
    }, supabase)

    setSaving(false)
    onConfirmed()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center"
      style={{ background: 'rgba(35,31,32,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white w-full max-w-lg rounded-t-2xl max-h-[92vh] flex flex-col shadow-2xl">

        <div className="px-5 py-4 border-b border-[rgba(118,118,118,0.1)] flex items-start justify-between shrink-0">
          <div>
            <h2 className="font-black text-[#231F20] text-base">صرفيات المهمة</h2>
            <p className="text-xs text-sky-700 mt-1">أدخل المبلغ والملاحظة لكل صرفية — تُخصم من محفظة الصرفيات عند اعتماد الإنجاز</p>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-xl leading-none hover:bg-slate-200 shrink-0">
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {expenseDefs.map((def, idx) => (
            <div key={def.id} className="border border-sky-200 rounded-xl p-4 bg-sky-50/40 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-bold text-[#231F20]">{def.name}</p>
                <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full">
                  الحد الأعلى {def.max_amount.toLocaleString('en-US')} د.ع
                </span>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#231F20] mb-1.5">المبلغ (د.ع) <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={rows[idx].amount}
                  onChange={e => setAmount(idx, e.target.value)}
                  className={INP}
                  placeholder="0"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#231F20] mb-1.5">ملاحظة <span className="text-red-500">*</span></label>
                <textarea
                  rows={2}
                  value={rows[idx].note}
                  onChange={e => setNote(idx, e.target.value)}
                  className={INP + ' resize-none'}
                  placeholder="تفاصيل الصرفية..."
                />
              </div>
            </div>
          ))}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3 font-bold">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[rgba(118,118,118,0.1)] shrink-0">
          <button onClick={handleConfirm} disabled={saving}
            className="w-full py-3.5 rounded-xl text-white font-black text-sm disabled:opacity-60 bg-sky-600 hover:bg-sky-700">
            {saving ? 'جارٍ الحفظ...' : 'موافق — متابعة الحقول الإلزامية'}
          </button>
        </div>
      </div>
    </div>
  )
}
