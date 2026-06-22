'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity-log'

interface Expense {
  id: string
  amount: number
  expense_type: string | null
  description: string | null
  expense_date: string
}

interface ExpenseType {
  id: string
  name: string
  default_amount: number
  requires_approval: boolean
}

interface Props {
  taskId: string
  debtorId: string
  caseId: string | null
  expenses: Expense[]
}

function fmt(n: number) { return Number(n).toLocaleString('ar-IQ') }

const INP = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2C8780]/20 focus:border-[#2C8780] bg-white transition-all'

export default function TaskExpenseForm({ taskId, debtorId, caseId, expenses: initialExpenses }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expenseTypes, setExpenseTypes] = useState<ExpenseType[]>([])
  const [showForm, setShowForm] = useState(false)

  const [form, setForm] = useState({
    expense_type_id: '',
    expense_type_name: '',
    amount: '',
    description: '',
    expense_date: new Date().toISOString().split('T')[0],
  })

  // Fetch active expense types from settings
  useEffect(() => {
    createClient()
      .from('expense_types')
      .select('id, name, default_amount, requires_approval')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => setExpenseTypes(data ?? []))
  }, [])

  function set(field: string, val: string) {
    setForm(prev => ({ ...prev, [field]: val }))
  }

  function handleTypeSelect(id: string) {
    const found = expenseTypes.find(t => t.id === id)
    if (!found) {
      setForm(prev => ({ ...prev, expense_type_id: '', expense_type_name: '', amount: '' }))
      return
    }
    setForm(prev => ({
      ...prev,
      expense_type_id: id,
      expense_type_name: found.name,
      amount: found.default_amount > 0 ? String(found.default_amount) : prev.amount,
    }))
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!form.expense_type_name.trim()) { setError('اختر نوع الصرف'); return }
    const amt = Number(form.amount)
    if (!amt || amt <= 0) { setError('يرجى إدخال مبلغ صحيح'); return }
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('يرجى تسجيل الدخول'); setSaving(false); return }

    const { error: dbErr } = await supabase.from('expenses').insert({
      debtor_id: debtorId,
      task_id: taskId,
      case_id: caseId ?? null,
      amount: amt,
      expense_type: form.expense_type_name,
      description: form.description || null,
      expense_date: form.expense_date,
      created_by: user.id,
    })

    if (dbErr) { setError(dbErr.message); setSaving(false); return }

    await logActivity({
      action: 'add_expense',
      entity_type: 'expense',
      entity_id: debtorId,
      description: `إضافة صرفية: ${amt.toLocaleString('ar-IQ')} د.ع — ${form.expense_type_name}`,
    }, supabase)

    setForm({
      expense_type_id: '',
      expense_type_name: '',
      amount: '',
      description: '',
      expense_date: new Date().toISOString().split('T')[0],
    })
    setSaving(false)
    setShowForm(false)
    router.refresh()
  }

  const total = initialExpenses.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-amber-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h2 className="font-bold text-slate-700 text-sm">صرفيات المهمة</h2>
          {initialExpenses.length > 0 && (
            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              {initialExpenses.length} صرفية
            </span>
          )}
        </div>
        {total > 0 && (
          <span className="text-sm font-black text-amber-600 tabular-nums">{fmt(total)} د.ع</span>
        )}
      </div>

      {/* Expenses list */}
      {initialExpenses.length > 0 && (
        <div className="divide-y divide-slate-50">
          {initialExpenses.map(exp => (
            <div key={exp.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                {exp.expense_type && (
                  <p className="text-sm font-semibold text-slate-800 leading-tight">{exp.expense_type}</p>
                )}
                {exp.description && (
                  <p className="text-xs text-slate-400 truncate mt-0.5">{exp.description}</p>
                )}
                <p className="text-[11px] text-slate-400 mt-0.5" dir="ltr">{exp.expense_date}</p>
              </div>
              <span className="text-sm font-black text-slate-800 shrink-0 tabular-nums">{fmt(Number(exp.amount))} د.ع</span>
            </div>
          ))}
        </div>
      )}

      {/* Add expense toggle */}
      {!showForm ? (
        <div className="px-4 py-3.5 border-t border-slate-100">
          <button
            onClick={() => setShowForm(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            إضافة صرفية جديدة
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="px-4 py-4 border-t border-slate-100 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-black text-slate-600">إضافة صرف جديد</p>
            <button type="button" onClick={() => setShowForm(false)}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors">إلغاء</button>
          </div>

          {/* Expense type - dropdown */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">نوع الصرف <span className="text-red-500">*</span></label>
            <select
              value={form.expense_type_id}
              onChange={e => handleTypeSelect(e.target.value)}
              className={INP}
              required
            >
              <option value="">— اختر نوع الصرفية —</option>
              {expenseTypes.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {form.expense_type_id && expenseTypes.find(t => t.id === form.expense_type_id)?.requires_approval && (
              <p className="text-[11px] text-orange-600 mt-1.5 flex items-center gap-1">
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                هذا النوع يحتاج موافقة الإدارة
              </p>
            )}
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">المبلغ (د.ع) <span className="text-red-500">*</span></label>
            <input
              type="number" min="1" value={form.amount}
              onChange={e => set('amount', e.target.value)}
              required placeholder="0" className={INP} dir="ltr"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">الوصف / الملاحظة</label>
            <input
              type="text" value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="تفاصيل إضافية..." className={INP}
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">التاريخ</label>
            <input
              type="date" value={form.expense_date}
              onChange={e => set('expense_date', e.target.value)}
              className={INP} dir="ltr"
            />
          </div>

          {error && (
            <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
          )}

          <button
            type="submit" disabled={saving}
            className="w-full py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-60 transition-opacity"
            style={{ background: 'linear-gradient(135deg,#d97706,#b45309)' }}
          >
            {saving ? 'جارٍ الإضافة...' : '+ تسجيل الصرفية'}
          </button>
        </form>
      )}
    </div>
  )
}
