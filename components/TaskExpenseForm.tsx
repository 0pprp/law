'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity-log'
import { PremiumSelect } from '@/components/ui/premium-select'
import { DatePicker } from '@/components/ui/date-picker'
import { formatMoney } from '@/lib/money-input'
import { localTodayYmd } from '@/lib/local-date'

interface ExpenseTypeDef {
  id: string
  name: string
  default_amount: number
  requires_attachment: boolean
  requires_note: boolean
  requires_gps: boolean
}

interface Expense {
  id: string
  amount: number
  expense_type: string | null
  description: string | null
  expense_date: string
  status: string | null
  rejection_reason: string | null
}

interface Props {
  taskId: string
  debtorId: string
  caseId: string | null
  branchId: string | null
  expenses: Expense[]
  taskDueDate?: string | null
}

const INP = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2C8780]/20 focus:border-[#2C8780] bg-white transition-all'

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  approved:         { label: 'معتمدة',           cls: 'bg-green-100 text-green-700' },
  pending_approval: { label: 'بانتظار الاعتماد', cls: 'bg-yellow-100 text-yellow-700' },
  rejected:         { label: 'مرفوضة',           cls: 'bg-red-100 text-red-700' },
}

export default function TaskExpenseForm({ taskId, debtorId, caseId, branchId, expenses: initialExpenses, taskDueDate }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expenseTypes, setExpenseTypes] = useState<ExpenseTypeDef[]>([])
  const [showForm, setShowForm] = useState(false)
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [gpsCoords, setGpsCoords] = useState('')
  const [noteText, setNoteText] = useState('')
  const [locating, setLocating] = useState(false)

  const [form, setForm] = useState({
    expense_type_id: '',
    expense_date: localTodayYmd(),
  })

  const expenseMaxDate = useMemo(() => {
    const today = localTodayYmd()
    if (!taskDueDate) return today
    return taskDueDate < today ? today : taskDueDate
  }, [taskDueDate])

  useEffect(() => {
    let q = createClient()
      .from('expense_types')
      .select('id, name, default_amount, requires_attachment, requires_note, requires_gps')
      .eq('is_active', true)
      .order('name')
    if (branchId) q = (q as any).eq('branch_id', branchId)
    q.then(({ data }) => setExpenseTypes((data ?? []) as ExpenseTypeDef[]))
  }, [branchId])

  const selectedType = expenseTypes.find(t => t.id === form.expense_type_id) ?? null

  function resetForm() {
    setForm({ expense_type_id: '', expense_date: localTodayYmd() })
    setAttachmentFile(null)
    setGpsCoords('')
    setNoteText('')
    setError('')
  }

  function getGPS() {
    if (!navigator.geolocation) { setError('المتصفح لا يدعم تحديد الموقع'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => { setGpsCoords(`${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`); setLocating(false) },
      () => { setError('تعذر تحديد الموقع الجغرافي'); setLocating(false) }
    )
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!form.expense_type_id || !selectedType) { setError('يجب اختيار نوع الصرفية'); return }
    if (selectedType.requires_attachment && !attachmentFile) { setError('يجب رفع المرفق المطلوب'); return }
    if (selectedType.requires_note && !noteText.trim()) { setError('يجب إدخال الملاحظة'); return }
    if (selectedType.requires_gps && !gpsCoords) { setError('يجب تحديد الموقع الجغرافي GPS'); return }

    setSaving(true); setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('يرجى تسجيل الدخول'); setSaving(false); return }

    let attachmentPath: string | null = null
    if (attachmentFile) {
      const body = new FormData()
      body.append('file', attachmentFile)
      body.append('taskId', taskId)
      body.append('kind', 'expense')
      const res = await fetch('/api/worker/upload-task-file', { method: 'POST', body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(`فشل رفع المرفق: ${data.error || 'خطأ غير معروف'}`); setSaving(false); return }
      attachmentPath = data.filePath as string
    }

    const { error: dbErr } = await (supabase as any).from('expenses').insert({
      debtor_id: debtorId,
      task_id: taskId,
      case_id: caseId ?? null,
      amount: selectedType.default_amount,
      expense_type: selectedType.name,
      expense_type_id: selectedType.id,
      description: noteText || null,
      expense_date: form.expense_date,
      created_by: user.id,
      status: 'pending_approval',
      branch_id: branchId,
      gps_coords: gpsCoords || null,
      attachment_path: attachmentPath,
    })

    if (dbErr) { setError(dbErr.message); setSaving(false); return }

    const { data: debtorRow } = await supabase
      .from('debtors')
      .select('case_type')
      .eq('id', debtorId)
      .maybeSingle()

    await logActivity({
      action: 'add_expense',
      entity_type: 'expense',
      entity_id: debtorId,
      description: `طلب صرفية: ${selectedType.name} — ${formatMoney(selectedType.default_amount)} (بانتظار الاعتماد)`,
      case_type: debtorRow?.case_type === 'criminal' ? 'criminal' : 'civil',
    }, supabase)

    resetForm()
    setSaving(false)
    setShowForm(false)
    router.refresh()
  }

  const total = initialExpenses.filter(e => e.status === 'approved' || e.status == null).reduce((s, e) => s + Number(e.amount), 0)

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
          <span className="text-sm font-black text-amber-600 tabular-nums">{formatMoney(total)}</span>
        )}
      </div>

      {/* Expenses list */}
      {initialExpenses.length > 0 && (
        <div className="divide-y divide-slate-50">
          {initialExpenses.map(exp => {
            const s = exp.status ?? 'approved'
            const cfg = STATUS_CONFIG[s] ?? STATUS_CONFIG.approved
            return (
              <div key={exp.id} className="flex items-start gap-3 px-4 py-3">
                <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center shrink-0 mt-0.5">
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
                  {s === 'rejected' && exp.rejection_reason && (
                    <p className="text-xs text-red-600 mt-0.5">سبب الرفض: {exp.rejection_reason}</p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-0.5" dir="ltr">{exp.expense_date}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-sm font-black text-slate-800 tabular-nums">{formatMoney(Number(exp.amount))}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>
                </div>
              </div>
            )
          })}
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
            <button type="button" onClick={() => { setShowForm(false); resetForm() }}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors">إلغاء</button>
          </div>

          {/* Expense type dropdown */}
          <div>
            <PremiumSelect
              value={form.expense_type_id}
              onChange={v => { setForm(f => ({ ...f, expense_type_id: v })); setError('') }}
              options={[
                { value: '', label: '— اختر نوع الصرفية —' },
                ...expenseTypes.map(t => ({ value: t.id, label: t.name })),
              ]}
              fieldLabel="نوع الصرف"
              placeholder="— اختر نوع الصرفية —"
              headerTitle="نوع الصرف"
              searchPlaceholder="بحث في أنواع الصرف..."
              searchable={expenseTypes.length > 4}
            />
          </div>

          {/* Locked amount display */}
          {selectedType && (
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <span className="text-xs font-bold text-amber-700">المبلغ المحدد (غير قابل للتعديل)</span>
              <span className="text-lg font-black text-amber-800 tabular-nums">{formatMoney(selectedType.default_amount)}</span>
            </div>
          )}

          {/* Conditional: Attachment */}
          {selectedType?.requires_attachment && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                المرفق <span className="text-red-500">*</span>
              </label>
              <input type="file" accept="image/*,.pdf"
                onChange={e => setAttachmentFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-slate-600 file:ml-3 file:mr-0 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:text-white file:cursor-pointer"
                style={{ '--file-bg': 'linear-gradient(135deg,#2C8780,#1D6365)' } as any} />
              {attachmentFile && <p className="text-xs text-[#2C8780] mt-1 font-semibold">✓ {attachmentFile.name}</p>}
            </div>
          )}

          {/* Conditional: Note */}
          {selectedType?.requires_note && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                ملاحظة <span className="text-red-500">*</span>
              </label>
              <textarea rows={3} value={noteText} onChange={e => setNoteText(e.target.value)}
                className={INP + ' resize-none'} placeholder="اكتب الملاحظة هنا..." />
            </div>
          )}

          {/* Conditional: GPS */}
          {selectedType?.requires_gps && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1.5">
                موقع GPS <span className="text-red-500">*</span>
              </label>
              <div className="flex gap-2">
                <input type="text" value={gpsCoords} readOnly
                  className={INP + ' flex-1 bg-slate-50'} placeholder="latitude, longitude" dir="ltr" />
                <button type="button" onClick={getGPS} disabled={locating}
                  className="shrink-0 px-3 py-2 text-xs font-bold text-white rounded-xl disabled:opacity-60 transition-opacity"
                  style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}>
                  {locating ? '...' : '📍 تحديد'}
                </button>
              </div>
              {gpsCoords && <p className="text-xs text-[#2C8780] mt-1 font-semibold">✓ تم تحديد الموقع</p>}
            </div>
          )}

          <DatePicker
            value={form.expense_date}
            onChange={v => setForm(f => ({ ...f, expense_date: v }))}
            fieldLabel="التاريخ"
            headerTitle="تاريخ الصرفية"
            maxDate={expenseMaxDate}
          />

          {error && (
            <p className="text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
          )}

          <button type="submit" disabled={saving || !form.expense_type_id}
            className="w-full py-2.5 rounded-xl font-bold text-white text-sm disabled:opacity-60 transition-opacity"
            style={{ background: 'linear-gradient(135deg,#d97706,#b45309)' }}>
            {saving ? 'جارٍ الإرسال...' : 'إرسال الصرفية للاعتماد'}
          </button>
          <p className="text-center text-[10px] text-slate-400">ستظهر الصرفية بانتظار موافقة الإدارة</p>
        </form>
      )}
    </div>
  )
}
