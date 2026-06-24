'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { TASK_TYPE_LABELS } from '@/lib/types'
import type { TaskType } from '@/lib/types'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { fmtMoney, fmtDate } from '@/lib/utils'

const PAYMENT_METHODS = ['نقدًا', 'حوالة مصرفية', 'صك', 'أخرى']
const EMPTY_FORM = {
  debtor_id: '', lawyer_id: '', task_id: '', amount: '',
  payment_date: new Date().toISOString().split('T')[0],
  payment_method: 'نقدًا', receipt_number: '', notes: '',
}

const INP = 'w-full border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'
const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm text-[#231F20] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

export default function PaymentsPage() {
  const branchId = useBranchId()
  const [debtors, setDebtors] = useState<any[]>([])
  const [lawyers, setLawyers] = useState<any[]>([])
  const [allTasks, setAllTasks] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingPayment, setEditingPayment] = useState<any | null>(null)
  const [editForm, setEditForm] = useState({ amount: '', payment_date: '', payment_method: 'نقدًا', receipt_number: '', notes: '' })
  const [editError, setEditError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterLawyer, setFilterLawyer] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const debtorTasks = useMemo(() =>
    form.debtor_id ? allTasks.filter(t => t.debtor_id === form.debtor_id) : [],
    [allTasks, form.debtor_id])

  function set(field: string, value: string) { setForm(prev => ({ ...prev, [field]: value })) }

  const load = useCallback(async () => {
    const supabase = createClient()
    let dq = supabase.from('debtors').select('id, full_name, governorate').order('full_name')
    let lq = supabase.from('profiles').select('id, full_name').eq('role', 'lawyer').eq('is_active', true).order('full_name')
    let tq = supabase.from('tasks').select('id, debtor_id, task_type')
    let pq = supabase.from('debtor_payments').select(`*, debtors(full_name, governorate), lawyer:profiles!debtor_payments_lawyer_id_fkey(full_name), creator:profiles!debtor_payments_created_by_fkey(full_name), task:tasks!debtor_payments_task_id_fkey(task_type)`).order('payment_date', { ascending: false })
    if (branchId) {
      dq = (dq as any).eq('branch_id', branchId)
      lq = (lq as any).eq('branch_id', branchId)
      tq = (tq as any).eq('branch_id', branchId)
      pq = (pq as any).eq('branch_id', branchId)
    }
    const [{ data: d }, { data: l }, { data: t }, { data: p }] = await Promise.all([dq, lq, tq, pq])
    setDebtors(d ?? []); setLawyers(l ?? []); setAllTasks(t ?? []); setPayments(p ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => payments.filter(p => {
    if (search && !p.debtors?.full_name?.includes(search)) return false
    if (filterLawyer && p.lawyer_id !== filterLawyer) return false
    if (dateFrom && p.payment_date < dateFrom) return false
    if (dateTo && p.payment_date > dateTo) return false
    return true
  }), [payments, search, filterLawyer, dateFrom, dateTo])

  const total = filtered.reduce((s, p) => s + Number(p.amount ?? 0), 0)

  function startEdit(p: any) {
    setEditingPayment(p)
    setEditForm({ amount: p.amount?.toString() ?? '', payment_date: p.payment_date ?? '', payment_method: p.payment_method ?? 'نقدًا', receipt_number: p.receipt_number ?? '', notes: p.notes ?? '' })
    setEditError(''); setShowForm(false)
  }

  async function saveEdit(e: { preventDefault(): void }) {
    e.preventDefault()
    const amt = Number(editForm.amount)
    if (!amt || amt <= 0) { setEditError('يرجى إدخال مبلغ صحيح'); return }
    setSaving(true); setEditError('')
    const supabase = createClient()
    const { error: dbErr } = await supabase.from('debtor_payments').update({ amount: amt, payment_date: editForm.payment_date, payment_method: editForm.payment_method || null, receipt_number: editForm.receipt_number || null, notes: editForm.notes || null }).eq('id', editingPayment.id)
    if (dbErr) { setEditError(dbErr.message); setSaving(false); return }
    await logActivity({ action: 'update_payment', entity_type: 'payment', entity_id: editingPayment.id, description: `تعديل تسديد: ${amt.toLocaleString('en-US')} د.ع — ${editingPayment.debtors?.full_name ?? ''}` }, supabase)
    setSaving(false); setEditingPayment(null); load()
  }

  async function deletePayment(id: string, debtorName: string, amount: number) {
    if (!confirm(`هل أنت متأكد من حذف هذا التسديد (${amount.toLocaleString('en-US')} د.ع) الخاص بـ "${debtorName}"؟`)) return
    setDeletingId(id)
    const supabase = createClient()
    const { error } = await supabase.from('debtor_payments').delete().eq('id', id)
    if (error) { alert(`فشل الحذف: ${error.message}`); setDeletingId(null); return }
    await logActivity({ action: 'delete_payment', entity_type: 'payment', entity_id: id, description: `حذف تسديد: ${amount.toLocaleString('en-US')} د.ع — ${debtorName}` }, supabase)
    setDeletingId(null); load()
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!form.debtor_id || !form.amount || Number(form.amount) <= 0) { setError('يرجى اختيار المدين وإدخال مبلغ صحيح'); return }
    setSaving(true); setError('')
    const supabase = createClient()
    const { error: dbErr } = await supabase.from('debtor_payments').insert({ debtor_id: form.debtor_id, lawyer_id: form.lawyer_id || null, task_id: form.task_id || null, amount: Number(form.amount), payment_date: form.payment_date, payment_method: form.payment_method || null, receipt_number: form.receipt_number || null, notes: form.notes || null })
    if (dbErr) { setError(dbErr.message); setSaving(false); return }
    await logActivity({ action: 'add_payment', entity_type: 'payment', entity_id: form.debtor_id, description: `تسجيل تسديد: ${Number(form.amount).toLocaleString('en-US')} د.ع` }, supabase)
    setForm(EMPTY_FORM); setSaving(false); setShowForm(false); load()
  }

  const lbl = 'block text-xs font-semibold text-[#231F20] mb-1.5'

  return (
    <div className="space-y-5">
      <PageHeader
        title="تسديدات الزبائن"
        subtitle={`${filtered.length} تسديد • الإجمالي: ${fmtMoney(total)}`}
        actions={
          <Button variant="primary" size="sm" onClick={() => { setShowForm(v => !v); setEditingPayment(null) }}>
            {showForm ? '✕ إغلاق' : '+ تسجيل تسديد'}
          </Button>
        }
      />

      {/* Edit panel */}
      {editingPayment && (
        <div className="bg-white rounded-xl border-2 border-[#2C8780]/30 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[rgba(118,118,118,0.1)]">
            <h2 className="font-bold text-[#231F20]">تعديل تسديد — <span className="text-[#2C8780]">{editingPayment.debtors?.full_name}</span></h2>
            <button onClick={() => setEditingPayment(null)} className="text-[#767676] hover:text-[#231F20] text-xl leading-none w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[rgba(118,118,118,0.08)]">×</button>
          </div>
          <form onSubmit={saveEdit} className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className={lbl}>المبلغ (د.ع) *</label>
              <input type="number" min="1" value={editForm.amount} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} className={INP} dir="ltr" required /></div>
            <div><label className={lbl}>تاريخ التسديد</label>
              <input type="date" value={editForm.payment_date} onChange={e => setEditForm(f => ({ ...f, payment_date: e.target.value }))} className={INP} dir="ltr" /></div>
            <div><label className={lbl}>طريقة الدفع</label>
              <select value={editForm.payment_method} onChange={e => setEditForm(f => ({ ...f, payment_method: e.target.value }))} className={INP}>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}</select></div>
            <div><label className={lbl}>رقم الوصل</label>
              <input type="text" value={editForm.receipt_number} onChange={e => setEditForm(f => ({ ...f, receipt_number: e.target.value }))} className={INP} dir="ltr" /></div>
            <div className="col-span-2"><label className={lbl}>ملاحظات</label>
              <input type="text" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} className={INP} /></div>
            {editError && <p className="col-span-4 text-red-600 text-xs">{editError}</p>}
            <div className="col-span-4 flex gap-2 pt-1">
              <Button type="submit" variant="primary" size="sm" loading={saving}>حفظ التعديل</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingPayment(null)}>إلغاء</Button>
            </div>
          </form>
        </div>
      )}

      {/* Add form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-5">
          <h2 className="font-bold text-[#231F20] mb-4 pb-3 border-b border-[rgba(118,118,118,0.1)]">تسجيل تسديد جديد</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div><label className={lbl}>المدين *</label>
                <select value={form.debtor_id} onChange={e => { set('debtor_id', e.target.value); set('task_id', '') }} className={INP} required>
                  <option value="">-- اختر المدين --</option>
                  {debtors.map(d => <option key={d.id} value={d.id}>{d.full_name}{d.governorate ? ` | ${d.governorate}` : ''}</option>)}
                </select></div>
              <div><label className={lbl}>المحامي</label>
                <select value={form.lawyer_id} onChange={e => set('lawyer_id', e.target.value)} className={INP}>
                  <option value="">-- بدون محامي --</option>
                  {lawyers.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
                </select></div>
              <div><label className={lbl}>المهمة المرتبطة</label>
                <select value={form.task_id} onChange={e => set('task_id', e.target.value)} className={INP} disabled={!form.debtor_id}>
                  <option value="">-- بدون مهمة --</option>
                  {debtorTasks.map(t => <option key={t.id} value={t.id}>{TASK_TYPE_LABELS[t.task_type as TaskType] ?? t.task_type}</option>)}
                </select></div>
              <div><label className={lbl}>المبلغ (د.ع) *</label>
                <input type="number" min="1" value={form.amount} onChange={e => set('amount', e.target.value)} required className={INP} dir="ltr" placeholder="0" /></div>
              <div><label className={lbl}>تاريخ التسديد</label>
                <input type="date" value={form.payment_date} onChange={e => set('payment_date', e.target.value)} className={INP} dir="ltr" /></div>
              <div><label className={lbl}>طريقة الدفع</label>
                <select value={form.payment_method} onChange={e => set('payment_method', e.target.value)} className={INP}>
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select></div>
              <div><label className={lbl}>رقم الوصل</label>
                <input type="text" value={form.receipt_number} onChange={e => set('receipt_number', e.target.value)} className={INP} dir="ltr" placeholder="اختياري" /></div>
              <div><label className={lbl}>ملاحظات</label>
                <input type="text" value={form.notes} onChange={e => set('notes', e.target.value)} className={INP} placeholder="اختياري" /></div>
            </div>
            {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</p>}
            <div className="flex gap-3">
              <Button type="submit" variant="primary" loading={saving}>تسجيل التسديد</Button>
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setError('') }}>إلغاء</Button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <input type="text" placeholder="بحث باسم المدين..." value={search} onChange={e => setSearch(e.target.value)} className={SEL} />
          <select value={filterLawyer} onChange={e => setFilterLawyer(e.target.value)} className={SEL}>
            <option value="">كل المحامين</option>
            {lawyers.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={SEL} dir="ltr" title="من تاريخ" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={SEL} dir="ltr" title="إلى تاريخ" />
        </div>
      </div>

      {/* Summary bar */}
      {!loading && filtered.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 flex items-center justify-between">
          <span className="text-sm text-emerald-700 font-medium">{filtered.length} تسديد في العرض الحالي</span>
          <span className="text-lg font-black text-emerald-800" dir="ltr">{fmtMoney(total)}</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
          </div>
        ) : !filtered.length ? (
          <EmptyState title="لا توجد تسديدات" description="سجّل أول تسديد باستخدام الزر أعلاه" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>المدين</TH>
                <TH>المحامي</TH>
                <TH>المهمة</TH>
                <TH>المبلغ</TH>
                <TH>طريقة الدفع</TH>
                <TH>رقم الوصل</TH>
                <TH>التاريخ</TH>
                <TH>أضيف بواسطة</TH>
                <TH className="text-center">الإجراءات</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((p: any) => (
                <TR key={p.id}>
                  <TD className="font-semibold text-[#231F20]">{p.debtors?.full_name ?? '—'}</TD>
                  <TD className="text-[#767676] text-xs">{p.lawyer?.full_name ?? '—'}</TD>
                  <TD className="text-[#767676] text-xs">{p.task?.task_type ? TASK_TYPE_LABELS[p.task.task_type as TaskType] : '—'}</TD>
                  <TD><span className="font-bold text-emerald-700 tabular-nums" dir="ltr">{fmtMoney(Number(p.amount))}</span></TD>
                  <TD className="text-[#767676] text-xs">{p.payment_method ?? '—'}</TD>
                  <TD><span className="font-mono text-xs text-[#767676]" dir="ltr">{p.receipt_number ?? '—'}</span></TD>
                  <TD><span className="font-mono text-xs text-[#767676]" dir="ltr">{fmtDate(p.payment_date)}</span></TD>
                  <TD className="text-[#767676] text-xs">{p.creator?.full_name ?? '—'}</TD>
                  <TD>
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => startEdit(p)} className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors">تعديل</button>
                      <button onClick={() => deletePayment(p.id, p.debtors?.full_name ?? '', Number(p.amount))} disabled={deletingId === p.id} className="text-xs text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                        {deletingId === p.id ? '...' : 'حذف'}
                      </button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </div>
  )
}