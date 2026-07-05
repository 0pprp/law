'use client'

import { useState } from 'react'
import { formatMoney, formatMoneyInput, parseMoneyInput } from '@/lib/money-input'
import type { TaskDefinitionExpense } from '@/lib/task-definition-expenses'
import type { PendingTaskExpense } from '@/lib/persist-task-expenses'
import { pendingRowsFromDefs, persistTaskExpenses, validateTaskExpenseModalRows } from '@/lib/persist-task-expenses'
import { createClient } from '@/lib/supabase/client'
import CenteredModalPortal from '@/components/ui/centered-modal-portal'

const INP = 'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/25 focus:border-sky-500 transition-all'

interface Props {
  task: {
    id: string
    debtor_id: string
    case_id?: string | null
    branch_id?: string | null
  }
  taskLabel: string
  expenseDefs: TaskDefinitionExpense[]
  onClose: () => void
  /** draft: يُخزّن مؤقتاً ويُرسل مع الإنجاز — immediate: يُحفظ في DB فوراً */
  mode?: 'draft' | 'immediate'
  onConfirmed: (rows: PendingTaskExpense[]) => void
}

export default function TaskCompletionExpenseModal({
  task,
  taskLabel,
  expenseDefs,
  onClose,
  mode = 'draft',
  onConfirmed,
}: Props) {
  const [rows, setRows] = useState(() =>
    expenseDefs.map(() => ({ amount: '', note: '' })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function setAmount(idx: number, raw: string) {
    const digits = raw.replace(/[^\d]/g, '')
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, amount: formatMoneyInput(digits) } : r)))
    setError('')
  }

  function setNote(idx: number, val: string) {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, note: val } : r)))
    setError('')
  }

  async function handleConfirm() {
    const err = validateTaskExpenseModalRows(expenseDefs, rows)
    if (err) { setError(err); return }

    const pending = pendingRowsFromDefs(expenseDefs, rows)

    if (mode === 'draft') {
      onConfirmed(pending)
      onClose()
      return
    }

    setSaving(true)
    setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('يرجى تسجيل الدخول'); setSaving(false); return }

    const result = await persistTaskExpenses(supabase, {
      taskId: task.id,
      debtorId: task.debtor_id,
      caseId: task.case_id,
      branchId: task.branch_id,
      lawyerId: user.id,
      rows: pending,
    })

    if (!result.ok) {
      setError(result.error ?? 'فشل حفظ الصرفيات')
      setSaving(false)
      return
    }

    setSaving(false)
    onConfirmed(pending)
    onClose()
  }

  return (
    <CenteredModalPortal onBackdropClick={onClose} zIndex={55} ariaLabelledBy="task-expense-modal-title">
      <div className="bg-white w-full max-w-lg rounded-2xl max-h-[min(85vh,720px)] flex flex-col shadow-2xl border border-slate-200/80">

        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between shrink-0">
          <div className="min-w-0 pr-2">
            <h2 id="task-expense-modal-title" className="font-black text-[#231F20] text-base">صرفيات المهمة</h2>
            <p className="text-sm font-bold text-[#2C8780] mt-1 truncate">{taskLabel}</p>
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <p className="text-xs font-bold text-amber-900 leading-relaxed">
                جميع البنود إلزامية — إذا لم تصرف على أي بند، اكتب <span className="font-black" dir="ltr">0</span>
              </p>
              <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">
                تُخصم المبالغ أكبر من 0 من محفظة الصرفيات عند اعتماد الإنجاز فقط
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-[#F3F1F2] text-[#767676] flex items-center justify-center text-xl leading-none hover:bg-slate-200 shrink-0"
            aria-label="إغلاق"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4 min-h-0">
          {expenseDefs.map((def, idx) => {
            const amt = rows[idx].amount.trim() === '' ? null : parseMoneyInput(rows[idx].amount)
            const noteRequired = amt !== null && amt > 0
            return (
              <div key={def.id} className="border border-sky-200 rounded-xl p-4 bg-sky-50/40 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-bold text-[#231F20]">{def.name} <span className="text-red-500">*</span></p>
                  <span className="text-[10px] font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                    الحد الأعلى {formatMoney(def.max_amount, { suffix: false })} د.ع
                  </span>
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#231F20] mb-1.5">
                    المبلغ الفعلي (د.ع) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={rows[idx].amount}
                    onChange={e => setAmount(idx, e.target.value)}
                    className={INP}
                    placeholder="0"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-[#231F20] mb-1.5">
                    ملاحظة {noteRequired && <span className="text-red-500">*</span>}
                  </label>
                  <textarea
                    rows={2}
                    value={rows[idx].note}
                    onChange={e => setNote(idx, e.target.value)}
                    className={INP + ' resize-none'}
                    placeholder={noteRequired ? 'تفاصيل الصرفية...' : 'اختياري عند المبلغ 0'}
                  />
                </div>
              </div>
            )
          })}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3 font-bold">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-100 shrink-0 bg-white rounded-b-2xl">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="w-full py-3.5 rounded-xl text-white font-black text-sm disabled:opacity-60 bg-sky-600 hover:bg-sky-700 transition-colors"
          >
            {saving ? 'جارٍ الحفظ...' : 'تم'}
          </button>
        </div>
      </div>
    </CenteredModalPortal>
  )
}
