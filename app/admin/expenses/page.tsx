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

const INP = 'w-full border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'
const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm text-[#231F20] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'
const lbl = 'block text-xs font-semibold text-[#231F20] mb-1.5'

export default function ExpensesPage() {
  const branchId = useBranchId()
  const [expenses, setExpenses] = useState<any[]>([])
  const [lawyers, setLawyers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [editingExpense, setEditingExpense] = useState<any | null>(null)
  const [editForm, setEditForm] = useState({ amount: '', expense_type: '', description: '', expense_date: '' })
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editError, setEditError] = useState('')
  const [search, setSearch] = useState('')
  const [filterLawyer, setFilterLawyer] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback(async () => {
    const supabase = createClient()
    let eq = supabase.from('expenses').select(`*, debtors(full_name, governorate), profiles!expenses_created_by_fkey(full_name), tasks!expenses_task_id_fkey(task_type)`).order('expense_date', { ascending: false })
    let lq = supabase.from('profiles').select('id, full_name').eq('role', 'lawyer').eq('is_active', true).order('full_name')
    if (branchId) {
      eq = (eq as any).eq('branch_id', branchId)
      lq = (lq as any).eq('branch_id', branchId)
    }
    const [{ data: e }, { data: l }] = await Promise.all([eq, lq])
    setExpenses(e ?? []); setLawyers(l ?? [])
    setLoading(false)
  }, [branchId])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => expenses.filter(exp => {
    if (search && !exp.debtors?.full_name?.includes(search)) return false
    if (filterLawyer && exp.created_by !== filterLawyer) return false
    if (dateFrom && exp.expense_date < dateFrom) return false
    if (dateTo && exp.expense_date > dateTo) return false
    return true
  }), [expenses, search, filterLawyer, dateFrom, dateTo])

  const total = filtered.reduce((s, e) => s + Number(e.amount ?? 0), 0)

  function startEdit(exp: any) {
    setEditingExpense(exp)
    setEditForm({ amount: exp.amount?.toString() ?? '', expense_type: exp.expense_type ?? '', description: exp.description ?? '', expense_date: exp.expense_date ?? '' })
    setEditError('')
  }

  async function saveEdit(e: { preventDefault(): void }) {
    e.preventDefault()
    const amt = Number(editForm.amount)
    if (!amt || amt <= 0) { setEditError('يرجى إدخال مبلغ صحيح'); return }
    setSaving(true); setEditError('')
    const supabase = createClient()
    const { error } = await supabase.from('expenses').update({ amount: amt, expense_type: editForm.expense_type || null, description: editForm.description || null, expense_date: editForm.expense_date }).eq('id', editingExpense.id)
    if (error) { setEditError(error.message); setSaving(false); return }
    await logActivity({ action: 'update_expense', entity_type: 'expense', entity_id: editingExpense.id, description: `تعديل صرفية: ${amt.toLocaleString('en-US')} د.ع — ${editingExpense.debtors?.full_name ?? ''}` }, supabase)
    setSaving(false); setEditingExpense(null); load()
  }

  async function deleteExpense(id: string, debtorName: string, amount: number) {
    if (!confirm(`هل أنت متأكد من حذف هذه الصرفية (${amount.toLocaleString('en-US')} د.ع) الخاصة بـ "${debtorName}"؟`)) return
    setDeletingId(id)
    const supabase = createClient()
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) { alert(`فشل الحذف: ${error.message}`); setDeletingId(null); return }
    await logActivity({ action: 'delete_expense', entity_type: 'expense', entity_id: id, description: `حذف صرفية: ${amount.toLocaleString('en-US')} د.ع — ${debtorName}` }, supabase)
    setDeletingId(null); load()
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="الصرفيات"
        subtitle={`${filtered.length} صرف • الإجمالي: ${fmtMoney(total)}`}
      />

      {/* Edit panel */}
      {editingExpense && (
        <div className="bg-white rounded-xl border-2 border-[#2C8780]/30 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[rgba(118,118,118,0.1)]">
            <h2 className="font-bold text-[#231F20]">تعديل صرفية — <span className="text-[#2C8780]">{editingExpense.debtors?.full_name}</span></h2>
            <button onClick={() => setEditingExpense(null)} className="text-[#767676] hover:text-[#231F20] w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[rgba(118,118,118,0.08)] text-xl leading-none">×</button>
          </div>
          <form onSubmit={saveEdit} className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className={lbl}>المبلغ (د.ع) *</label>
              <input type="number" min="1" value={editForm.amount} onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))} className={INP} dir="ltr" required /></div>
            <div><label className={lbl}>نوع الصرف</label>
              <input type="text" value={editForm.expense_type} onChange={e => setEditForm(f => ({ ...f, expense_type: e.target.value }))} className={INP} /></div>
            <div><label className={lbl}>الوصف</label>
              <input type="text" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} className={INP} /></div>
            <div><label className={lbl}>التاريخ</label>
              <input type="date" value={editForm.expense_date} onChange={e => setEditForm(f => ({ ...f, expense_date: e.target.value }))} className={INP} dir="ltr" /></div>
            {editError && <p className="col-span-4 text-red-600 text-xs">{editError}</p>}
            <div className="col-span-4 flex gap-2 pt-1">
              <Button type="submit" variant="primary" size="sm" loading={saving}>حفظ التعديل</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingExpense(null)}>إلغاء</Button>
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

      {!loading && filtered.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 flex items-center justify-between">
          <span className="text-sm text-red-700 font-medium">{filtered.length} صرفية في العرض الحالي</span>
          <span className="text-lg font-black text-red-800" dir="ltr">{fmtMoney(total)}</span>
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
          <EmptyState title="لا توجد صرفيات" description="لم يتم تسجيل أي صرفيات بعد" />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>المدين</TH>
                <TH>المحامي</TH>
                <TH>المهمة</TH>
                <TH>نوع الصرف</TH>
                <TH>الوصف</TH>
                <TH>المبلغ</TH>
                <TH>التاريخ</TH>
                <TH className="text-center">الإجراءات</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((exp: any) => (
                <TR key={exp.id} className={editingExpense?.id === exp.id ? 'bg-[#2C8780]/5' : ''}>
                  <TD className="font-semibold text-[#231F20]">{exp.debtors?.full_name ?? '—'}</TD>
                  <TD className="text-[#767676] text-xs">{exp.profiles?.full_name ?? '—'}</TD>
                  <TD className="text-[#767676] text-xs">{exp.tasks?.task_type ? TASK_TYPE_LABELS[exp.tasks.task_type as TaskType] : '—'}</TD>
                  <TD className="text-[#767676] text-xs">{exp.expense_type ?? '—'}</TD>
                  <TD className="text-[#767676] text-xs max-w-[140px]"><span className="line-clamp-1">{exp.description ?? '—'}</span></TD>
                  <TD><span className="font-bold text-[#231F20] tabular-nums" dir="ltr">{fmtMoney(Number(exp.amount))}</span></TD>
                  <TD><span className="font-mono text-xs text-[#767676]" dir="ltr">{fmtDate(exp.expense_date)}</span></TD>
                  <TD>
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => startEdit(exp)} className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors">تعديل</button>
                      <button onClick={() => deleteExpense(exp.id, exp.debtors?.full_name ?? '', Number(exp.amount))} disabled={deletingId === exp.id} className="text-xs text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                        {deletingId === exp.id ? '...' : 'حذف'}
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