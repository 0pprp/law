'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { TASK_TYPE_LABELS } from '@/lib/types'
import type { TaskType } from '@/lib/types'
import { logActivity } from '@/lib/activity-log'
import { refreshAdminNotifications } from '@/lib/admin-notifications'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import AdminDisbursementWalletPanel from '@/components/AdminDisbursementWalletPanel'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { DEBTOR_SEARCH_PLACEHOLDER, resolveDebtorIdsBySearch } from '@/lib/debtor-search'
import { PremiumSelect } from '@/components/ui/premium-select'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { useCanWrite } from '@/hooks/use-can-write'
import { PERMISSION_DENIED_MSG } from '@/lib/permissions'
import { DatePicker } from '@/components/ui/date-picker'

const INP = 'w-full border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2.5 text-sm text-[#231F20] placeholder:text-[#767676] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'
const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm text-[#231F20] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'
const lbl = 'block text-xs font-semibold text-[#231F20] mb-1.5'

type StatusFilter = 'all' | 'pending_review' | 'pending_approval' | 'approved' | 'rejected'

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all',              label: 'الكل' },
  { key: 'pending_review',   label: 'مع الإنجاز' },
  { key: 'approved',         label: 'المعتمدة' },
  { key: 'rejected',         label: 'المرفوضة' },
]

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  approved:         { label: 'معتمدة',           cls: 'bg-green-100 text-green-700' },
  pending_review:   { label: 'مع الإنجاز',       cls: 'bg-yellow-100 text-yellow-700' },
  pending_approval: { label: 'مع الإنجاز',       cls: 'bg-yellow-100 text-yellow-700' },
  rejected:         { label: 'مرفوضة',           cls: 'bg-red-100 text-red-700' },
}

function normalizeStatus(s: string | null | undefined): string {
  if (s === 'pending_approval' || s === 'pending') return 'pending_review'
  return s ?? 'approved'
}

export default function ExpensesPage() {
  const branchId = useBranchId()
  const canWrite = useCanWrite()
  const searchParams = useSearchParams()
  const initialStatus = searchParams.get('status') as StatusFilter | null
  const initialType = searchParams.get('type')
  const [expenses, setExpenses] = useState<any[]>([])
  const [lawyers, setLawyers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    initialStatus && STATUS_TABS.some(t => t.key === initialStatus) ? initialStatus : 'all',
  )
  const [typeFilter, setTypeFilter] = useState(initialType ?? '')
  const [editingExpense, setEditingExpense] = useState<any | null>(null)
  const [editForm, setEditForm] = useState({ amount: '', expense_type: '', description: '', expense_date: '' })
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editError, setEditError] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [filterLawyer, setFilterLawyer] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [rejectModal, setRejectModal] = useState<{ id: string; debtorName: string } | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectSaving, setRejectSaving] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    let eq = supabase.from('expenses').select(`*, debtors(full_name, governorate, phone, receipt_number), profiles!expenses_created_by_fkey(full_name), tasks!expenses_task_id_fkey(task_type)`).order('expense_date', { ascending: false }).limit(500)
    let lq = supabase.from('profiles').select('id, full_name').eq('role', 'lawyer').eq('is_active', true).order('full_name')
    if (branchId) {
      eq = (eq as any).eq('branch_id', branchId)
      lq = (lq as any).eq('branch_id', branchId)
    }
    if (debouncedSearch.trim()) {
      const ids = await resolveDebtorIdsBySearch(supabase, debouncedSearch, branchId)
      if (!ids?.length) {
        setExpenses([])
        const { data: l } = await lq
        setLawyers(l ?? [])
        setLoading(false)
        return
      }
      eq = (eq as any).in('debtor_id', ids)
    }
    const [{ data: e }, { data: l }] = await Promise.all([eq, lq])
    setExpenses(e ?? []); setLawyers(l ?? [])
    setLoading(false)
  }, [branchId, debouncedSearch])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => expenses.filter(exp => {
    const s = normalizeStatus(exp.status)
    if (statusFilter !== 'all') {
      if (statusFilter === 'pending_review') {
        if (s !== 'pending_review') return false
      } else if (s !== statusFilter) return false
    }
    if (typeFilter && (exp.expense_type ?? '') !== typeFilter) return false
    if (filterLawyer && exp.created_by !== filterLawyer) return false
    if (dateFrom && exp.expense_date < dateFrom) return false
    if (dateTo && exp.expense_date > dateTo) return false
    return true
  }), [expenses, filterLawyer, dateFrom, dateTo, statusFilter, typeFilter])

  const total = filtered.filter(e => (e.status ?? 'approved') === 'approved').reduce((s, e) => s + Number(e.amount ?? 0), 0)

  const pendingCount = expenses.filter(e => normalizeStatus(e.status) === 'pending_review').length

  function startEdit(exp: any) {
    setEditingExpense(exp)
    setEditForm({ amount: exp.amount?.toString() ?? '', expense_type: exp.expense_type ?? '', description: exp.description ?? '', expense_date: exp.expense_date ?? '' })
    setEditError('')
  }

  async function saveEdit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!canWrite) { setEditError(PERMISSION_DENIED_MSG); return }
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
    if (!canWrite) { alert(PERMISSION_DENIED_MSG); return }
    if (!confirm(`هل أنت متأكد من حذف هذه الصرفية (${amount.toLocaleString('en-US')} د.ع) الخاصة بـ "${debtorName}"؟`)) return
    setDeletingId(id)
    const supabase = createClient()
    const { error } = await supabase.from('expenses').delete().eq('id', id)
    if (error) { alert(`فشل الحذف: ${error.message}`); setDeletingId(null); return }
    await logActivity({ action: 'delete_expense', entity_type: 'expense', entity_id: id, description: `حذف صرفية: ${amount.toLocaleString('en-US')} د.ع — ${debtorName}` }, supabase)
    setDeletingId(null); load()
  }

  async function approveExpense() {
    alert('صرفيات المهام تُعتمد تلقائياً عند اعتماد الإنجاز من مراجعة المهام')
  }

  async function confirmReject() {
    if (!canWrite) { alert(PERMISSION_DENIED_MSG); return }
    if (!rejectModal) return
    setRejectSaving(true)
    const supabase = createClient()
    const { error } = await (supabase as any).from('expenses').update({ status: 'rejected', rejection_reason: rejectReason || 'مرفوضة من قبل الإدارة' }).eq('id', rejectModal.id)
    if (error) { alert(error.message); setRejectSaving(false); return }
    await logActivity({ action: 'reject_expense', entity_type: 'expense', entity_id: rejectModal.id, description: `رفض صرفية — ${rejectModal.debtorName} — السبب: ${rejectReason || 'لا يوجد سبب'}` }, supabase)
    setRejectSaving(false); setRejectModal(null); setRejectReason(''); load(); refreshAdminNotifications()
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="الصرفيات"
        subtitle={`${filtered.length} صرف • المعتمدة: ${fmtMoney(total)}`}
      />

      <AdminDisbursementWalletPanel readOnly={!canWrite} />

      {typeFilter && (
        <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5">
          <span className="text-sm font-bold text-orange-900">تصفية: {typeFilter}</span>
          <button onClick={() => setTypeFilter('')} className="text-xs font-bold text-orange-700 hover:underline">إلغاء</button>
        </div>
      )}

      {/* Pending alert */}
      {pendingCount > 0 && statusFilter === 'all' && (
        <button
          onClick={() => setStatusFilter('pending_review')}
          className="w-full flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-3 hover:bg-yellow-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
            <span className="text-sm font-bold text-yellow-800">{pendingCount} صرفية بانتظار الاعتماد</span>
          </div>
          <span className="text-xs text-yellow-600 font-semibold">مراجعة ←</span>
        </button>
      )}

      {/* Status tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_TABS.map(tab => (
          <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
            className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              statusFilter === tab.key
                ? 'bg-[#2C8780] text-white shadow-sm'
                : 'bg-white border border-[rgba(118,118,118,0.2)] text-[#767676] hover:border-[#2C8780]/40 hover:text-[#231F20]'
            }`}>
            {tab.label}
            {tab.key === 'pending_review' && pendingCount > 0 && (
              <span className={`mr-1.5 text-[11px] px-1.5 py-0.5 rounded-full ${statusFilter === tab.key ? 'bg-white/20' : 'bg-yellow-100 text-yellow-700'}`}>
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Edit panel (only for approved) */}
      {canWrite && editingExpense && (
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
            <DatePicker
              value={editForm.expense_date}
              onChange={v => setEditForm(f => ({ ...f, expense_date: v }))}
              fieldLabel="التاريخ"
              headerTitle="تاريخ الصرفية"
            />
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
          <input type="search" placeholder={DEBTOR_SEARCH_PLACEHOLDER} value={search} onChange={e => setSearch(e.target.value)} className={SEL} />
          <PremiumSelect
            value={filterLawyer}
            onChange={setFilterLawyer}
            options={[
              { value: '', label: 'كل المحامين' },
              ...lawyers.map(l => ({ value: l.id, label: l.full_name })),
            ]}
            placeholder="كل المحامين"
            headerTitle="تصفية حسب المحامي"
            searchPlaceholder="بحث بالاسم..."
            searchable
          />
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={({ dateFrom: f, dateTo: t }) => { setDateFrom(f); setDateTo(t) }}
          />
        </div>
      </div>

      {!loading && filtered.length > 0 && total > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 flex items-center justify-between">
          <span className="text-sm text-red-700 font-medium">{filtered.filter(e => (e.status ?? 'approved') === 'approved').length} صرفية معتمدة</span>
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
          <EmptyState title="لا توجد صرفيات" description={statusFilter === 'pending_approval' ? 'لا توجد صرفيات بانتظار الاعتماد' : 'لم يتم تسجيل أي صرفيات'} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>المدين</TH>
                <TH>المحامي</TH>
                <TH>نوع الصرف</TH>
                <TH>الوصف</TH>
                <TH>المبلغ</TH>
                <TH>التاريخ</TH>
                <TH className="text-center">الحالة</TH>
                <TH className="text-center">الإجراءات</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((exp: any) => {
                const s = normalizeStatus(exp.status)
                const badge = STATUS_BADGE[s] ?? STATUS_BADGE.approved
                const isPendingReview = s === 'pending_review'
                const linkedToTask = Boolean(exp.task_id)
                return (
                  <TR key={exp.id} className={editingExpense?.id === exp.id ? 'bg-[#2C8780]/5' : isPendingReview ? 'bg-yellow-50/50' : ''}>
                    <TD className="font-semibold text-[#231F20]">{exp.debtors?.full_name ?? '—'}</TD>
                    <TD className="text-[#767676] text-xs">{exp.profiles?.full_name ?? '—'}</TD>
                    <TD className="text-[#767676] text-xs">{exp.expense_type ?? '—'}</TD>
                    <TD className="text-[#767676] text-xs max-w-[120px]">
                      <span className="line-clamp-1">{exp.description ?? '—'}</span>
                      {s === 'rejected' && exp.rejection_reason && (
                        <p className="text-red-500 text-[10px] mt-0.5 line-clamp-1">سبب: {exp.rejection_reason}</p>
                      )}
                    </TD>
                    <TD><span className="font-bold text-[#231F20] tabular-nums" dir="ltr">{fmtMoney(Number(exp.amount))}</span></TD>
                    <TD><span className="font-mono text-xs text-[#767676]" dir="ltr">{fmtDate(exp.expense_date)}</span></TD>
                    <TD className="text-center">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    </TD>
                    <TD>
                      {canWrite ? (
                      <div className="flex items-center justify-center gap-1.5">
                        {isPendingReview && linkedToTask ? (
                          <span className="text-[10px] text-yellow-700 font-bold px-2 py-1">تُعتمد مع الإنجاز</span>
                        ) : isPendingReview ? (
                          <>
                            <button
                              onClick={() => approveExpense()}
                              className="text-xs font-bold text-green-700 border border-green-200 bg-green-50 hover:bg-green-100 px-2.5 py-1.5 rounded-lg"
                            >
                              اعتماد
                            </button>
                            <button
                              onClick={() => setRejectModal({ id: exp.id, debtorName: exp.debtors?.full_name ?? '' })}
                              className="text-xs font-bold text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg"
                            >
                              رفض
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(exp)} className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors">تعديل</button>
                            <button onClick={() => deleteExpense(exp.id, exp.debtors?.full_name ?? '', Number(exp.amount))} disabled={deletingId === exp.id} className="text-xs text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                              {deletingId === exp.id ? '...' : 'حذف'}
                            </button>
                          </>
                        )}
                      </div>
                      ) : <span className="text-xs text-[#767676] block text-center">—</span>}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </div>

      {/* Reject Modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(35,31,32,0.55)', backdropFilter: 'blur(2px)' }}
          onClick={e => { if (e.target === e.currentTarget) { setRejectModal(null); setRejectReason('') } }}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <h2 className="font-bold text-[#231F20] text-sm">رفض الصرفية</h2>
            <p className="text-sm text-[#767676]">المدين: <span className="font-bold text-[#231F20]">{rejectModal.debtorName}</span></p>
            <div>
              <label className="block text-xs font-semibold text-[#231F20] mb-1.5">سبب الرفض (اختياري)</label>
              <textarea rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                className={INP + ' resize-none'} placeholder="اكتب سبب الرفض..." />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setRejectModal(null); setRejectReason('') }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[rgba(118,118,118,0.2)] text-[#767676] hover:bg-slate-50 transition-colors">
                إلغاء
              </button>
              <button onClick={confirmReject} disabled={rejectSaving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 transition-colors">
                {rejectSaving ? 'جارٍ الرفض...' : 'تأكيد الرفض'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
