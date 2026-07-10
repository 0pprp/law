'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { logActivity } from '@/lib/activity-log'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { DebtorSearchPicker } from '@/components/ui/debtor-search-picker'
import { FormField, formInputClass } from '@/components/ui/form-flow'
import { fmtMoney, fmtDate, cn } from '@/lib/utils'
import { parseMoneyInput, formatMoney } from '@/lib/money-input'
import MoneyInput from '@/components/ui/money-input'
import { RECEIPT_AMOUNT_LABEL } from '@/lib/ui-labels'
import {
  DEBTOR_SEARCH_PLACEHOLDER,
  resolveDebtorIdsBySearch,
  type DebtorSearchRow,
} from '@/lib/debtor-search'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { useAdminRole } from '@/context/admin-role'
import { canAddPayments, canEditRecords, canDelete, PERMISSION_DENIED_MSG } from '@/lib/permissions'
import { appAlert, appConfirm } from '@/lib/app-dialog'
import { syncDebtorRemainingAfterPayments } from '@/lib/debtor-balances'

const EMPTY_FORM = { debtor_id: '', amount: '', notes: '' }
const INP = formInputClass

export default function PaymentsPage() {
  const branchId = useBranchId()
  const role = useAdminRole()
  const allowAdd = canAddPayments(role)
  const allowEdit = canEditRecords(role)
  const allowDelete = canDelete(role)
  const [payments, setPayments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedDebtor, setSelectedDebtor] = useState<DebtorSearchRow | null>(null)
  const [editingPayment, setEditingPayment] = useState<any | null>(null)
  const [editForm, setEditForm] = useState({ amount: '', notes: '' })
  const [editError, setEditError] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function set(field: string, value: string) { setForm(prev => ({ ...prev, [field]: value })) }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    let pq = supabase
      .from('debtor_payments')
      .select(`*, debtors(full_name, governorate, phone, receipt_number), creator:profiles!debtor_payments_created_by_fkey(full_name)`)
      .order('payment_date', { ascending: false })
      .limit(500)

    if (branchId) pq = (pq as any).eq('branch_id', branchId)

    if (debouncedSearch.trim()) {
      const ids = await resolveDebtorIdsBySearch(supabase, debouncedSearch, branchId)
      if (!ids?.length) {
        setPayments([])
        setLoading(false)
        return
      }
      pq = (pq as any).in('debtor_id', ids)
    }

    const { data: p } = await pq
    setPayments(p ?? [])
    setLoading(false)
  }, [branchId, debouncedSearch])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => payments.filter(p => {
    if (dateFrom && p.payment_date < dateFrom) return false
    if (dateTo && p.payment_date > dateTo) return false
    return true
  }), [payments, dateFrom, dateTo])

  const total = filtered.reduce((s, p) => s + Number(p.amount ?? 0), 0)

  function startEdit(p: any) {
    setEditingPayment(p)
    setEditForm({ amount: p.amount?.toString() ?? '', notes: p.notes ?? '' })
    setEditError('')
    setShowForm(false)
  }

  async function saveEdit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!allowEdit) { setEditError(PERMISSION_DENIED_MSG); return }
    const amt = parseMoneyInput(editForm.amount)
    if (!amt || amt <= 0) { setEditError('يرجى إدخال مبلغ صحيح'); return }
    setSaving(true)
    setEditError('')
    const supabase = createClient()
    const { error: dbErr } = await supabase.from('debtor_payments').update({
      amount: amt,
      notes: editForm.notes || null,
    }).eq('id', editingPayment.id)
    if (dbErr) { setEditError(dbErr.message); setSaving(false); return }
    const debtorId = editingPayment.debtor_id ?? editingPayment.debtors?.id
    if (debtorId) {
      const syncResult = await syncDebtorRemainingAfterPayments(supabase, debtorId)
      if (!syncResult.ok) { setEditError(syncResult.error ?? 'فشل تحديث المتبقي'); setSaving(false); return }
    }
    await logActivity({
      action: 'update_payment',
      entity_type: 'payment',
      entity_id: editingPayment.id,
      description: `تعديل تسديد: ${formatMoney(amt)} — ${editingPayment.debtors?.full_name ?? ''}`,
    }, supabase)
    setSaving(false)
    setEditingPayment(null)
    load()
  }

  async function deletePayment(id: string, debtorId: string, debtorName: string, amount: number) {
    if (!allowDelete) { await appAlert({ message: PERMISSION_DENIED_MSG, variant: 'warning' }); return }
    const ok = await appConfirm({
      title: 'تأكيد الحذف',
      message: `هل أنت متأكد من حذف هذا التسديد (${formatMoney(amount)}) الخاص بـ «${debtorName}»؟\nسيُعاد المبلغ إلى المتبقي.`,
      confirmLabel: 'حذف',
      danger: true,
    })
    if (!ok) return
    setDeletingId(id)
    const supabase = createClient()
    const { error } = await supabase.from('debtor_payments').delete().eq('id', id)
    if (error) { await appAlert({ message: `فشل الحذف: ${error.message}`, variant: 'error' }); setDeletingId(null); return }
    const syncResult = await syncDebtorRemainingAfterPayments(supabase, debtorId)
    if (!syncResult.ok) { await appAlert({ message: syncResult.error ?? 'فشل تحديث المتبقي', variant: 'error' }); setDeletingId(null); return }
    await logActivity({
      action: 'delete_payment',
      entity_type: 'payment',
      entity_id: id,
      description: `حذف تسديد: ${formatMoney(amount)} — ${debtorName}`,
    }, supabase)
    setDeletingId(null)
    load()
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!allowAdd) { setError(PERMISSION_DENIED_MSG); return }
    if (!form.debtor_id || !form.amount || parseMoneyInput(form.amount) <= 0) {
      setError('يرجى اختيار المدين وإدخال مبلغ صحيح')
      return
    }
    setSaving(true)
    setError('')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('يجب تسجيل الدخول'); setSaving(false); return }
    const paymentDate = new Date().toISOString().split('T')[0]
    const { error: dbErr } = await supabase.from('debtor_payments').insert({
      debtor_id: form.debtor_id,
      amount: parseMoneyInput(form.amount),
      payment_date: paymentDate,
      notes: form.notes || null,
      created_by: user.id,
      ...(branchId ? { branch_id: branchId } : {}),
    })
    if (dbErr) { setError(dbErr.message); setSaving(false); return }
    const syncResult = await syncDebtorRemainingAfterPayments(supabase, form.debtor_id)
    if (!syncResult.ok) { setError(syncResult.error ?? 'فشل تحديث المتبقي'); setSaving(false); return }
    await logActivity({
      action: 'add_payment',
      entity_type: 'payment',
      entity_id: form.debtor_id,
      description: `تسجيل تسديد: ${formatMoney(parseMoneyInput(form.amount))}`,
    }, supabase)
    setForm(EMPTY_FORM)
    setSelectedDebtor(null)
    setSaving(false)
    setShowForm(false)
    load()
  }

  function handleDebtorPick(debtorId: string, debtor: DebtorSearchRow | null) {
    set('debtor_id', debtorId)
    setSelectedDebtor(debtor)
  }

  const SEL = 'border border-[rgba(118,118,118,0.2)] rounded-lg px-3 py-2 text-sm text-[#231F20] focus:outline-none focus:ring-2 focus:ring-[#2C8780]/25 focus:border-[#2C8780] bg-white transition-all'

  return (
    <div className="space-y-5">
      <PageHeader
        title="تسديدات الزبائن"
        subtitle={`${filtered.length} تسديد • الإجمالي: ${fmtMoney(total)}`}
        actions={
          allowAdd ? (
          <Button variant="primary" size="sm" onClick={() => { setShowForm(v => !v); setEditingPayment(null) }}>
            {showForm ? '✕ إغلاق' : '+ تسجيل تسديد'}
          </Button>
          ) : undefined
        }
      />

      {allowEdit && editingPayment && (
        <div className="bg-white rounded-xl border-2 border-[#2C8780]/30 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[rgba(118,118,118,0.1)]">
            <h2 className="font-bold text-[#231F20]">
              تعديل تسديد — <span className="text-[#2C8780]">{editingPayment.debtors?.full_name}</span>
            </h2>
            <button onClick={() => setEditingPayment(null)} className="text-[#767676] hover:text-[#231F20] text-xl leading-none w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[rgba(118,118,118,0.08)]">×</button>
          </div>
          <form onSubmit={saveEdit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label={`${RECEIPT_AMOUNT_LABEL} (د.ع)`} required>
              <MoneyInput value={editForm.amount} onChange={v => setEditForm(f => ({ ...f, amount: v }))} className={INP} required />
            </FormField>
            <FormField label="ملاحظات">
              <input type="text" value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} className={INP} />
            </FormField>
            {editError && <p className="md:col-span-2 text-red-600 text-xs">{editError}</p>}
            <div className="md:col-span-2 flex gap-2 pt-1">
              <Button type="submit" variant="primary" size="sm" loading={saving}>حفظ التعديل</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditingPayment(null)}>إلغاء</Button>
            </div>
          </form>
        </div>
      )}

      {allowAdd && showForm && (
        <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-5">
          <h2 className="font-bold text-[#231F20] mb-4 pb-3 border-b border-[rgba(118,118,118,0.1)]">تسجيل تسديد جديد</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="المدينة / المدين" required hint="اكتب للبحث — لا تُحمّل كل المدينين">
                <DebtorSearchPicker
                  value={form.debtor_id}
                  onChange={handleDebtorPick}
                  branchId={branchId}
                  disabled={!branchId}
                />
              </FormField>
              <FormField label={`${RECEIPT_AMOUNT_LABEL} (د.ع)`} required>
                <MoneyInput value={form.amount} onChange={v => set('amount', v)} required className={INP} placeholder="0" />
              </FormField>
              <div className="md:col-span-2">
                <FormField label="ملاحظات">
                  <input type="text" value={form.notes} onChange={e => set('notes', e.target.value)} className={INP} placeholder="اختياري" />
                </FormField>
              </div>
            </div>

            {selectedDebtor && (
              <div className="flex flex-wrap items-center gap-4 bg-[#2C8780]/5 border border-[#2C8780]/20 rounded-xl px-4 py-3 text-sm">
                <div>
                  <p className="text-[10px] text-[#767676]">المحافظة</p>
                  <p className="font-bold text-[#231F20]">{selectedDebtor.governorate ?? '—'}</p>
                </div>
                {selectedDebtor.phone && (
                  <div>
                    <p className="text-[10px] text-[#767676]">رقم الهاتف</p>
                    <p className="font-mono font-bold text-[#231F20]" dir="ltr">{selectedDebtor.phone}</p>
                  </div>
                )}
                {selectedDebtor.receipt_number && (
                  <div>
                    <p className="text-[10px] text-[#767676]">رقم الوصل</p>
                    <p className="font-mono font-bold text-[#231F20]" dir="ltr">{selectedDebtor.receipt_number}</p>
                  </div>
                )}
                <p className="text-[10px] text-[#767676] mr-auto">يُسجّل تاريخ التسديد تلقائياً عند الحفظ</p>
              </div>
            )}

            {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</p>}
            <div className="flex gap-3">
              <Button type="submit" variant="primary" loading={saving}>تسجيل التسديد</Button>
              <Button type="button" variant="outline" onClick={() => { setShowForm(false); setError('') }}>إلغاء</Button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="search"
            placeholder={DEBTOR_SEARCH_PLACEHOLDER}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className={cn(SEL, 'md:col-span-1')}
          />
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={({ dateFrom: f, dateTo: t }) => { setDateFrom(f); setDateTo(t) }}
          />
        </div>
        {debouncedSearch.trim() && !loading && (
          <p className="text-xs text-[#767676] mt-2">نتائج البحث عن: «{debouncedSearch}»</p>
        )}
      </div>

      {!loading && filtered.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 flex items-center justify-between">
          <span className="text-sm text-emerald-700 font-medium">{filtered.length} تسديد في العرض الحالي</span>
          <span className="text-lg font-black text-emerald-800" dir="ltr">{fmtMoney(total)}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <svg className="w-6 h-6 animate-spin text-[#2C8780]" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            <p className="text-sm text-[#767676]">جارٍ التحميل...</p>
          </div>
        ) : !filtered.length ? (
          <EmptyState
            title={debouncedSearch.trim() ? 'لا توجد نتائج' : 'لا توجد تسديدات'}
            description={debouncedSearch.trim() ? 'جرّب بحثاً مختلفاً' : 'سجّل أول تسديد باستخدام الزر أعلاه'}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>المدين</TH>
                <TH>المحافظة</TH>
                <TH>الهاتف</TH>
                <TH>{RECEIPT_AMOUNT_LABEL}</TH>
                <TH>التاريخ</TH>
                <TH>ملاحظات</TH>
                <TH className="text-center">الإجراءات</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((p: any) => (
                <TR key={p.id}>
                  <TD className="font-semibold text-[#231F20]">{p.debtors?.full_name ?? '—'}</TD>
                  <TD className="text-[#767676] text-xs">{p.debtors?.governorate ?? '—'}</TD>
                  <TD><span className="font-mono text-xs text-[#767676]" dir="ltr">{p.debtors?.phone ?? '—'}</span></TD>
                  <TD><span className="font-bold text-emerald-700 tabular-nums" dir="ltr">{fmtMoney(Number(p.amount))}</span></TD>
                  <TD><span className="font-mono text-xs text-[#767676]" dir="ltr">{fmtDate(p.payment_date)}</span></TD>
                  <TD className="text-[#767676] text-xs max-w-[160px] truncate">{p.notes ?? '—'}</TD>
                  <TD>
                    {(allowEdit || allowDelete) ? (
                    <div className="flex items-center justify-center gap-2">
                      {allowEdit && (
                      <button onClick={() => startEdit(p)} className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors">تعديل</button>
                      )}
                      {allowDelete && (
                      <button onClick={() => deletePayment(p.id, p.debtor_id, p.debtors?.full_name ?? '', Number(p.amount))} disabled={deletingId === p.id} className="text-xs text-red-600 border border-red-200 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                        {deletingId === p.id ? '...' : 'حذف'}
                      </button>
                      )}
                    </div>
                    ) : <span className="text-xs text-[#767676] block text-center">—</span>}
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
