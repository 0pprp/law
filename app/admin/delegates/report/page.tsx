'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canManageDelegateFees, canManageDelegates } from '@/lib/permissions'
import {
  DEBTOR_NOTIFIED_LABELS,
  DEBTOR_NOTIFIED_OPTIONS,
  DELEGATE_FEE_STATUS_LABELS,
  type DebtorNotifiedStatus,
  type DelegateFeeStatus,
} from '@/lib/delegate'
import type { DelegateReportRow } from '@/lib/delegate-wallet'
import { fetchDelegateReport } from '@/lib/delegate-wallet'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { PremiumSelect } from '@/components/ui/premium-select'
import { fmtDate, fmtMoney, fmtNum } from '@/lib/utils'

const FEE_BADGE: Record<DelegateFeeStatus, 'warning' | 'success' | 'gray' | 'default'> = {
  none: 'default',
  pending: 'warning',
  available: 'success',
  withdrawn: 'gray',
}

const FEE_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'pending', label: DELEGATE_FEE_STATUS_LABELS.pending },
  { value: 'available', label: DELEGATE_FEE_STATUS_LABELS.available },
  { value: 'withdrawn', label: DELEGATE_FEE_STATUS_LABELS.withdrawn },
]

export default function DelegateReportPage() {
  const router = useRouter()
  const branchId = useBranchId()
  const role = useAdminRole()
  const canView = canManageDelegates(role)
  const canEdit = canManageDelegateFees(role)

  const [rows, setRows] = useState<DelegateReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [filterDelegate, setFilterDelegate] = useState('')
  const [filterFeeStatus, setFilterFeeStatus] = useState('')

  const load = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    setError('')
    const supabase = createClient()
    const data = await fetchDelegateReport(supabase, branchId)
    setRows(data)
    setLoading(false)
  }, [branchId, canView])

  useEffect(() => {
    if (!canView) {
      router.replace('/admin/dashboard')
      return
    }
    load()
  }, [canView, load, router])

  const delegateOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const r of rows) map.set(r.delegate_id, r.delegate_name)
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
  }, [rows])

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (filterDelegate && r.delegate_id !== filterDelegate) return false
      if (filterFeeStatus && r.fee_status !== filterFeeStatus) return false
      return true
    })
  }, [rows, filterDelegate, filterFeeStatus])

  const totals = useMemo(() => {
    let pending = 0
    let available = 0
    let withdrawn = 0
    for (const r of filtered) {
      if (r.fee_status === 'pending') pending += r.fee_amount
      else if (r.fee_status === 'available') available += r.fee_amount
      else if (r.fee_status === 'withdrawn') withdrawn += r.fee_amount
    }
    return { pending, available, withdrawn, count: filtered.length }
  }, [filtered])

  async function updateNotified(taskId: string, status: DebtorNotifiedStatus) {
    if (!canEdit) return
    setSavingId(taskId)
    setError('')
    const res = await fetch('/api/admin/delegate-notified', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, status }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error ?? 'فشل تحديث حالة التبليغ')
      setSavingId(null)
      return
    }
    setSavingId(null)
    await load()
  }

  async function exportExcel() {
    const XLSX = await import('xlsx')
    const sheetRows = filtered.map(r => ({
      'المندوب': r.delegate_name,
      'الفرع': r.branch_name,
      'قائمة المدين': r.debtor_list_name,
      'المدين': r.debtor_name,
      'المهمة': r.task_label,
      'تاريخ الإنجاز': r.completed_at ? fmtDate(r.completed_at) : '—',
      'هل تم تبليغ المدين': DEBTOR_NOTIFIED_LABELS[r.debtor_notified],
      'الأتعاب': fmtNum(r.fee_amount),
      'حالة الأتعاب': DELEGATE_FEE_STATUS_LABELS[r.fee_status],
      'تاريخ الصرف': r.withdrawn_at ? fmtDate(r.withdrawn_at) : '—',
    }))
    const ws = XLSX.utils.json_to_sheet(sheetRows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'مندوبون')
    XLSX.writeFile(wb, `تقرير-مندوبين-${Date.now()}.xlsx`)
  }

  return (
    <div className="min-h-[calc(100vh-6rem)] flex flex-col gap-5">
      <PageHeader
        title="تقرير أتعاب المندوبين"
        subtitle={`${totals.count} سجل ظاهر · ${rows.length} إجمالي`}
        breadcrumb={[
          { label: 'المندوبون', href: '/admin/delegates' },
          { label: 'التقرير' },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
              تحديث
            </Button>
            <Button variant="outline" size="sm" onClick={exportExcel} disabled={!filtered.length}>
              تصدير Excel
            </Button>
            <Link href="/admin/delegates/wallets">
              <Button variant="outline" size="sm">المحافظ</Button>
            </Link>
          </div>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] p-4 shadow-sm">
          <p className="text-[11px] font-bold text-[#767676] mb-1">السجلات</p>
          <p className="text-2xl font-black text-[#231F20] tabular-nums">{totals.count}</p>
        </div>
        <div className="bg-white rounded-2xl border border-amber-200/80 p-4 shadow-sm">
          <p className="text-[11px] font-bold text-amber-700/80 mb-1">معلق</p>
          <p className="text-xl font-black text-amber-700 tabular-nums" dir="ltr">{fmtMoney(totals.pending)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-[#2C8780]/25 p-4 shadow-sm">
          <p className="text-[11px] font-bold text-[#2C8780]/90 mb-1">قابل للصرف</p>
          <p className="text-xl font-black text-[#2C8780] tabular-nums" dir="ltr">{fmtMoney(totals.available)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
          <p className="text-[11px] font-bold text-[#767676] mb-1">مصروف</p>
          <p className="text-xl font-black text-slate-600 tabular-nums" dir="ltr">{fmtMoney(totals.withdrawn)}</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.12)] shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <div className="min-w-[12rem] flex-1 max-w-sm">
          <PremiumSelect
            value={filterDelegate}
            onChange={setFilterDelegate}
            options={[
              { value: '', label: 'كل المندوبين' },
              ...delegateOptions.map(d => ({ value: d.id, label: d.name })),
            ]}
            placeholder="كل المندوبين"
            fieldLabel="المندوب"
            headerTitle="تصفية حسب المندوب"
            searchPlaceholder="بحث..."
          />
        </div>
        <div className="min-w-[10rem] max-w-xs">
          <PremiumSelect
            value={filterFeeStatus}
            onChange={setFilterFeeStatus}
            options={FEE_STATUS_FILTER_OPTIONS}
            placeholder="كل الحالات"
            fieldLabel="حالة الأتعاب"
            headerTitle="حالة الأتعاب"
            searchable={false}
          />
        </div>
      </div>

      <div className="flex-1 bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm min-h-[22rem]">
        {loading ? (
          <div className="py-24 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-2 border-[#2C8780]/30 border-t-[#2C8780] rounded-full animate-spin" />
            <p className="text-sm text-[#767676]">جارٍ تحميل التقرير...</p>
          </div>
        ) : !filtered.length ? (
          <EmptyState
            title={rows.length ? 'لا نتائج لهذا الفلتر' : 'لا توجد سجلات'}
            description={
              rows.length
                ? 'غيّر الفلتر أو اضغط تحديث'
                : 'ستظهر هنا مهام إيجاد العنوان بعد اعتماد إنجاز المندوب'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <tr>
                  <TH>المندوب</TH>
                  <TH>الفرع</TH>
                  <TH>قائمة المدين</TH>
                  <TH>المدين</TH>
                  <TH>المهمة</TH>
                  <TH>الإنجاز</TH>
                  <TH>هل تم تبليغ المدين</TH>
                  <TH>الأتعاب</TH>
                  <TH>حالة الأتعاب</TH>
                </tr>
              </THead>
              <TBody>
                {filtered.map(r => (
                  <TR key={r.task_id}>
                    <TD><span className="font-semibold text-[#231F20]">{r.delegate_name}</span></TD>
                    <TD><span className="text-xs text-[#767676]">{r.branch_name}</span></TD>
                    <TD><span className="text-xs text-[#767676]">{r.debtor_list_name}</span></TD>
                    <TD>
                      {r.debtor_id ? (
                        <Link href={`/admin/debtors/${r.debtor_id}/account`} className="text-sm text-[#2C8780] font-semibold hover:underline">
                          {r.debtor_name}
                        </Link>
                      ) : r.debtor_name}
                    </TD>
                    <TD><span className="text-xs">{r.task_label}</span></TD>
                    <TD><span className="text-xs" dir="ltr">{r.completed_at ? fmtDate(r.completed_at) : '—'}</span></TD>
                    <TD className="min-w-[10rem] relative z-10">
                      {canEdit && r.fee_status !== 'withdrawn' ? (
                        <PremiumSelect
                          value={r.debtor_notified}
                          onChange={v => updateNotified(r.task_id, v as DebtorNotifiedStatus)}
                          options={DEBTOR_NOTIFIED_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                          disabled={savingId === r.task_id}
                          placeholder="لم يحدد"
                          headerTitle="هل تم تبليغ المدين"
                          searchable={false}
                          menuPortal
                          className="min-w-[9rem]"
                        />
                      ) : (
                        <span className="text-xs font-semibold">{DEBTOR_NOTIFIED_LABELS[r.debtor_notified]}</span>
                      )}
                    </TD>
                    <TD><span className="text-xs font-bold tabular-nums" dir="ltr">{fmtMoney(r.fee_amount)}</span></TD>
                    <TD>
                      <Badge variant={FEE_BADGE[r.fee_status]}>
                        {DELEGATE_FEE_STATUS_LABELS[r.fee_status]}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
