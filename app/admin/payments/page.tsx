'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useBranch, useBranchId } from '@/context/branch'
import {
  OperationBranchSelect,
  OPERATION_BRANCH_REQUIRED_MSG,
  useOperationBranch,
} from '@/components/OperationBranchSelect'
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
import { newClientRequestId } from '@/lib/client-request-id'
import {
  DEBTOR_SEARCH_PLACEHOLDER,
  resolveDebtorIdsBySearch,
  type DebtorSearchRow,
} from '@/lib/debtor-search'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { useAdminRole } from '@/context/admin-role'
import { canAddPayments, canEditRecords, canDelete, PERMISSION_DENIED_MSG } from '@/lib/permissions'
import { useCaseScope } from '@/hooks/use-case-scope'
import { appAlert, appConfirm } from '@/lib/app-dialog'
import { PremiumSelect } from '@/components/ui/premium-select'
import { CASE_TYPE_FILTER_OPTIONS, CASE_TYPE_LABELS } from '@/lib/case-type'

const EMPTY_FORM = { debtor_id: '', amount: '', notes: '' }
const INP = formInputClass

export default function PaymentsPage() {
  const branchId = useBranchId()
  const { viewAllBranches, listId } = useBranch()
  const {
    needsPick,
    effectiveBranchId,
    pickedId,
    setPickedBranch,
    validateOperationBranch,
  } = useOperationBranch()
  const role = useAdminRole()
  const { caseTypeFilter: lockedCaseType } = useCaseScope()
  const [filterCaseType, setFilterCaseType] = useState<'' | 'civil' | 'criminal'>(lockedCaseType ?? '')
  const effectiveCaseType = lockedCaseType ?? (filterCaseType || null)
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
  const submitLock = useRef(false)
  const paymentRequestIdRef = useRef<string | null>(null)

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

    const scopeListId = (!viewAllBranches && listId) ? listId : null
    let debtorIds: string[] | null = null

    if (scopeListId && branchId) {
      const { resolveDebtorIdsByBranchList } = await import('@/lib/branch-lists')
      debtorIds = await resolveDebtorIdsByBranchList(supabase, branchId, scopeListId)
      if (!debtorIds.length) {
        setPayments([])
        setLoading(false)
        return
      }
    }

    if (effectiveCaseType && !debouncedSearch.trim()) {
      let dq = supabase.from('debtors').select('id').eq('case_type', effectiveCaseType)
      if (branchId) dq = dq.eq('branch_id', branchId)
      if (scopeListId) dq = dq.eq('branch_list_id', scopeListId)
      const { data: scopedDebtors } = await dq.limit(5000)
      const ctIds = (scopedDebtors ?? []).map(d => d.id)
      if (!ctIds.length) {
        setPayments([])
        setLoading(false)
        return
      }
      debtorIds = debtorIds ? debtorIds.filter(id => ctIds.includes(id)) : ctIds
      if (!debtorIds.length) {
        setPayments([])
        setLoading(false)
        return
      }
    }

    if (debouncedSearch.trim()) {
      const searchIds = await resolveDebtorIdsBySearch(
        supabase,
        debouncedSearch,
        branchId,
        200,
        scopeListId,
        effectiveCaseType,
      )
      if (!searchIds?.length) {
        setPayments([])
        setLoading(false)
        return
      }
      debtorIds = debtorIds
        ? debtorIds.filter(id => searchIds.includes(id))
        : searchIds
      if (!debtorIds.length) {
        setPayments([])
        setLoading(false)
        return
      }
    }

    if (debtorIds) pq = (pq as any).in('debtor_id', debtorIds)

    const { data: p } = await pq
    setPayments(p ?? [])
    setLoading(false)
  }, [branchId, viewAllBranches, listId, debouncedSearch, effectiveCaseType])

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
    if (!allowEdit || saving) { setEditError(PERMISSION_DENIED_MSG); return }
    const amt = parseMoneyInput(editForm.amount)
    if (!amt || amt <= 0) { setEditError('يرجى إدخال مبلغ صحيح'); return }
    setSaving(true)
    setEditError('')
    try {
      const res = await fetch(`/api/admin/payments/${editingPayment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, notes: editForm.notes || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setEditError(typeof data.error === 'string' ? data.error : 'فشل التعديل')
        setSaving(false)
        return
      }
      setSaving(false)
      setEditingPayment(null)
      load()
    } catch {
      setEditError('فشل التعديل')
      setSaving(false)
    }
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
    try {
      const res = await fetch(`/api/admin/payments/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        await appAlert({ message: typeof data.error === 'string' ? data.error : 'فشل الحذف', variant: 'error' })
        setDeletingId(null)
        return
      }
      setDeletingId(null)
      load()
    } catch {
      await appAlert({ message: 'فشل الحذف', variant: 'error' })
      setDeletingId(null)
    }
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault()
    if (!allowAdd) { setError(PERMISSION_DENIED_MSG); return }
    if (saving || submitLock.current) return
    const branchErr = validateOperationBranch()
    if (branchErr) { setError(branchErr); return }
    if (!form.debtor_id || !form.amount || parseMoneyInput(form.amount) <= 0) {
      setError('يرجى اختيار المدين وإدخال مبلغ صحيح')
      return
    }
    submitLock.current = true
    setSaving(true)
    setError('')
    if (!paymentRequestIdRef.current) paymentRequestIdRef.current = newClientRequestId()
    const clientRequestId = paymentRequestIdRef.current
    try {
      const res = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debtorId: form.debtor_id,
          amount: parseMoneyInput(form.amount),
          notes: form.notes || null,
          clientRequestId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(typeof data.error === 'string' ? data.error : 'فشل تسجيل التسديد')
        setSaving(false)
        submitLock.current = false
        return
      }
      setForm(EMPTY_FORM)
      setSelectedDebtor(null)
      paymentRequestIdRef.current = null
      setSaving(false)
      submitLock.current = false
      setShowForm(false)
      load()
    } catch {
      setError('فشل تسجيل التسديد')
      setSaving(false)
      submitLock.current = false
    }
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
            {needsPick && (
              <OperationBranchSelect
                value={pickedId}
                onChange={(id, name) => setPickedBranch(id, name)}
              />
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="المدينة / المدين" required hint="اكتب للبحث — لا تُحمّل كل المدينين">
                <DebtorSearchPicker
                  value={form.debtor_id}
                  onChange={handleDebtorPick}
                  branchId={effectiveBranchId}
                  caseType={effectiveCaseType}
                  disabled={!effectiveBranchId}
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
          <PremiumSelect
            value={lockedCaseType ?? filterCaseType}
            onChange={v => {
              if (lockedCaseType) return
              setFilterCaseType(v === 'civil' || v === 'criminal' ? v : '')
            }}
            options={
              lockedCaseType
                ? CASE_TYPE_FILTER_OPTIONS.filter(o => o.value === lockedCaseType).map(o => ({ value: o.value, label: o.label }))
                : CASE_TYPE_FILTER_OPTIONS.map(o => ({ value: o.value, label: o.label }))
            }
            placeholder="كل أنواع الدعاوى"
            fieldLabel="نوع الدعوى"
            headerTitle="تصفية حسب نوع الدعوى"
            searchable={false}
            disabled={Boolean(lockedCaseType)}
          />
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={({ dateFrom: f, dateTo: t }) => { setDateFrom(f); setDateTo(t) }}
          />
        </div>
        {(debouncedSearch.trim() || filterCaseType) && !loading && (
          <p className="text-xs text-[#767676] mt-2">
            {debouncedSearch.trim() ? `نتائج البحث عن: «${debouncedSearch}»` : ''}
            {filterCaseType ? ` · ${CASE_TYPE_LABELS[filterCaseType]}` : ''}
          </p>
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
