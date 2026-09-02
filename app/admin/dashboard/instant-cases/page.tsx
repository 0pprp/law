'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useBranch, useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canSendToFilePreparation, canViewInstantCases } from '@/lib/permissions'
import { PageHeader } from '@/components/ui/page-header'
import { BackButton } from '@/components/ui/back-button'
import { PremiumSelect } from '@/components/ui/premium-select'
import { fmtDate, fmtDateTime, fmtMoney } from '@/lib/utils'
import { RECEIPT_AMOUNT_LABEL } from '@/lib/ui-labels'
import ChangeDebtorTaskButton from '@/components/ChangeDebtorTaskButton'
import { appAlert, appConfirm } from '@/lib/app-dialog'
import { invalidateDashboardCounts } from '@/lib/dashboard-counts-cache'

type InstantNom = {
  id: string
  debtor_name: string
  sale_price: number
  status: 'pending' | 'approved'
  created_at: string
  reviewed_at: string | null
  debtor_id: string | null
  branch_id: string | null
  nominator_role: string
  branch?: { name: string } | null
  branch_list?: { name: string } | null
  nominator?: { full_name: string } | null
  debtor?: { id: string; file_preparation_status: string | null; receipt_amount?: number | null } | null
}

const STATUS_OPTS = [
  { value: '', label: 'كل الحالات' },
  { value: 'pending', label: 'بانتظار موافقة مدير الفرع' },
  { value: 'approved', label: 'تمت الموافقة' },
]

function debtorRowOf(n: InstantNom) {
  const d = n.debtor
  if (!d) return null
  return Array.isArray(d) ? d[0] : d
}

function prepStatusOf(n: InstantNom): string | null {
  return debtorRowOf(n)?.file_preparation_status ?? null
}

function receiptAmountOf(n: InstantNom): number | null {
  const fromDebtor = debtorRowOf(n)?.receipt_amount
  if (fromDebtor != null && Number(fromDebtor) > 0) return Number(fromDebtor)
  if (n.sale_price != null && Number(n.sale_price) > 0) return Number(n.sale_price)
  return null
}

export default function InstantCasesPage() {
  const branchId = useBranchId()
  const { viewAllBranches, listId } = useBranch()
  const role = useAdminRole()
  const allowSendPrep = canSendToFilePreparation(role)
  const [rows, setRows] = useState<InstantNom[]>([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [prepBusyId, setPrepBusyId] = useState<string | null>(null)

  const load = useCallback(async (searchOverride?: string) => {
    if (!canViewInstantCases(role)) return
    if (!branchId && !viewAllBranches) {
      setRows([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (viewAllBranches) params.set('viewAll', '1')
      else if (branchId) params.set('branchId', branchId)
      if (listId && !viewAllBranches) params.set('listId', listId)
      if (status) params.set('status', status)
      const term = searchOverride !== undefined ? searchOverride : q
      if (term.trim()) params.set('q', term.trim())
      const res = await fetch(`/api/admin/instant-cases?${params}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'فشل التحميل')
        setRows([])
        return
      }
      setRows((data.nominations ?? []) as InstantNom[])
    } finally {
      setLoading(false)
    }
  }, [role, branchId, viewAllBranches, listId, status, q])

  useEffect(() => {
    void load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- إعادة عند الفرع/القائمة/الحالة فقط
  }, [role, branchId, viewAllBranches, listId, status])

  async function sendToPreparation(n: InstantNom) {
    if (!n.debtor_id || !allowSendPrep || prepBusyId) return
    const ok = await appConfirm({
      title: 'إرسال للتجهيز',
      message: `إرسال «${n.debtor_name}» إلى المحاسب الرئيسي لتجهيز الملفات؟`,
      confirmLabel: 'إرسال',
    })
    if (!ok) return
    setPrepBusyId(n.id)
    try {
      const res = await fetch('/api/admin/debtors/send-to-preparation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debtorIds: [n.debtor_id] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = typeof data?.error === 'string'
          ? data.error
          : Array.isArray(data?.failed) && data.failed[0]?.reason
            ? data.failed[0].reason
            : 'فشل الإرسال للتجهيز'
        await appAlert({ title: 'تعذر الإرسال', message: msg })
        return
      }
      const updatedIds: string[] = Array.isArray(data.updatedIds) ? data.updatedIds : []
      const failed: { reason?: string }[] = Array.isArray(data.failed) ? data.failed : []
      if (updatedIds.includes(n.debtor_id)) {
        setRows(prev => prev.map(row => {
          if (row.id !== n.id) return row
          return {
            ...row,
            debtor: {
              id: n.debtor_id!,
              file_preparation_status: 'preparing',
              receipt_amount: debtorRowOf(n)?.receipt_amount,
            },
          }
        }))
        invalidateDashboardCounts()
      }
      if (failed.length) {
        await appAlert({
          title: 'تعذر الإرسال',
          message: failed[0]?.reason ?? 'فشل الإرسال للتجهيز',
        })
      }
    } finally {
      setPrepBusyId(null)
    }
  }

  if (!canViewInstantCases(role)) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
        ليست لديك صلاحية لعرض هذه الصفحة.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="الدعاوى الفورية"
        subtitle="ترشيحات الأسماء من المندوب/المحاسب الفرعي — مع تاريخ الترشيح"
        actions={<BackButton fallback="/admin/dashboard" />}
      />

      {!branchId && !viewAllBranches ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">
          اختر فرعاً من القائمة العلوية أو اختر «الكل».
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="sm:w-56">
              <label className="block text-xs font-bold text-slate-600 mb-1">الحالة</label>
              <PremiumSelect value={status} onChange={setStatus} options={STATUS_OPTS} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-slate-600 mb-1">بحث</label>
              <div className="flex gap-2">
                <input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void load(q) }}
                  placeholder="اسم المدين…"
                  className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#c2410c]/25"
                />
                <button
                  type="button"
                  onClick={() => void load(q)}
                  className="px-4 py-2.5 rounded-xl text-sm font-bold text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg,#c2410c,#9a3412)' }}
                >
                  بحث
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          )}

          {loading ? (
            <p className="text-sm text-slate-500">جاري التحميل…</p>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
              لا توجد ترشيحات
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-sm">
              <table className="w-full min-w-max text-sm" dir="rtl">
                <thead>
                  <tr className="bg-orange-50/80 text-slate-700 text-xs">
                    <th className="text-right px-4 py-3 font-bold">الاسم</th>
                    <th className="text-right px-4 py-3 font-bold">{RECEIPT_AMOUNT_LABEL}</th>
                    <th className="text-right px-4 py-3 font-bold">القائمة</th>
                    <th className="text-right px-4 py-3 font-bold">الفرع</th>
                    <th className="text-right px-4 py-3 font-bold">المرشِّح</th>
                    <th className="text-right px-4 py-3 font-bold">تاريخ الترشيح</th>
                    <th className="text-right px-4 py-3 font-bold">الحالة</th>
                    <th className="text-right px-4 py-3 font-bold">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(n => {
                    const prep = prepStatusOf(n)
                    const isPreparing = prep === 'preparing'
                    const receiptAmount = receiptAmountOf(n)
                    return (
                      <tr key={n.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-semibold text-[#231F20]">{n.debtor_name}</td>
                        <td className="px-4 py-3 tabular-nums font-semibold" dir="ltr">
                          {receiptAmount != null ? fmtMoney(receiptAmount) : '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {(n.branch_list as { name?: string } | null)?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {(n.branch as { name?: string } | null)?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {(n.nominator as { full_name?: string } | null)?.full_name
                            ?? (n.nominator_role === 'delegate' ? 'مندوب' : 'محاسب')}
                        </td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          <span title={fmtDateTime(n.created_at)}>{fmtDate(n.created_at)}</span>
                        </td>
                        <td className="px-4 py-3">
                          {n.status === 'pending' ? (
                            <span className="inline-flex text-xs font-bold px-2 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
                              بانتظار موافقة مدير الفرع
                            </span>
                          ) : isPreparing ? (
                            <span className="inline-flex text-xs font-bold px-2 py-1 rounded-lg bg-sky-50 text-sky-800 border border-sky-200">
                              قيد التجهيز
                            </span>
                          ) : (
                            <span className="inline-flex text-xs font-bold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200">
                              تمت الموافقة
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {n.status === 'approved' && n.debtor_id ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/admin/debtors/${n.debtor_id}/account`}
                                className="text-xs font-bold text-[#2C8780] hover:underline"
                              >
                                ملف المدين
                              </Link>
                              {allowSendPrep && !isPreparing && (
                                <button
                                  type="button"
                                  disabled={prepBusyId === n.id}
                                  onClick={() => void sendToPreparation(n)}
                                  className="text-xs font-bold text-sky-700 hover:underline disabled:opacity-50"
                                >
                                  {prepBusyId === n.id ? 'جاري الإرسال…' : 'إرسال للتجهيز'}
                                </button>
                              )}
                              {isPreparing && (
                                <Link
                                  href="/admin/dashboard/awaiting-assignment?prep=1&ct=civil"
                                  className="text-xs font-bold text-sky-700 hover:underline"
                                >
                                  عرض التجهيز
                                </Link>
                              )}
                              <Link
                                href="/admin/dashboard/awaiting-assignment?ct=civil"
                                className="text-xs font-bold text-violet-700 hover:underline"
                              >
                                إسناد مهمة
                              </Link>
                              <ChangeDebtorTaskButton
                                debtorId={n.debtor_id}
                                branchId={n.branch_id}
                                buttonLabel="إسناد المهمة"
                                compact
                              />
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
