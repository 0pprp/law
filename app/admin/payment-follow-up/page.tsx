'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useBranch, useBranchId } from '@/context/branch'
import { useAdminRole } from '@/context/admin-role'
import { canAddPayments, canSubmitPaymentNoncomplianceRequest, isPaymentFollowUp } from '@/lib/permissions'
import { fmtDate, fmtMoney } from '@/lib/utils'
import { PageHeader } from '@/components/ui/page-header'
import { PremiumSelect } from '@/components/ui/premium-select'
import DebtorPaymentModal from '@/components/DebtorPaymentModal'
import SendNoncomplianceRequestModal from '@/components/SendNoncomplianceRequestModal'
import { fetchSelectableBranches, resetBranchesCache } from '@/lib/branches-cache'
import { refreshAdminNotifications } from '@/lib/admin-notifications'
import { appAlert } from '@/lib/app-dialog'
import {
  fetchPaymentInProgressDebtors,
  type PaymentInProgressDebtor,
} from '@/lib/payment-in-progress'
import { fetchPendingNoncomplianceByDebtorIds } from '@/lib/payment-noncompliance'
import { useCaseScope } from '@/hooks/use-case-scope'

const PAGE_SIZE = 30
const ALL_GOVS = ''

export default function PaymentFollowUpPage() {
  const branchId = useBranchId()
  const { viewAllBranches, setBranch, setViewAllBranches, listId } = useBranch()
  const role = useAdminRole()
  const { caseTypeFilter } = useCaseScope()
  const allowPay = canAddPayments(role)
  const followUpOnly = isPaymentFollowUp(role)
  const allowNoncompliance = canSubmitPaymentNoncomplianceRequest(role)

  const [rows, setRows] = useState<PaymentInProgressDebtor[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState('')
  const [payFor, setPayFor] = useState<PaymentInProgressDebtor | null>(null)
  const [noncomplianceFor, setNoncomplianceFor] = useState<PaymentInProgressDebtor | null>(null)
  const [pendingRequestByDebtor, setPendingRequestByDebtor] = useState<Map<string, string>>(new Map())
  const [govOptions, setGovOptions] = useState<{ value: string; label: string }[]>([])
  const [governoratesLoading, setGovernoratesLoading] = useState(true)
  const [switchingGov, setSwitchingGov] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // مسؤول متابعة التسديد يرى كل المحافظات؛ الفلتر عبر BranchSelector / القائمة أدناه
  const scopeBranch = viewAllBranches ? null : branchId
  const scopeListId = viewAllBranches ? null : listId
  const showBranchCol = viewAllBranches || followUpOnly

  useEffect(() => {
    // قد يكون الكاش القديم فارغاً إذا فشلت RLS قبل تطبيق سياسة الدور.
    resetBranchesCache()
    void fetchSelectableBranches(createClient())
      .then(list => {
        setGovOptions([
          { value: ALL_GOVS, label: 'كل المحافظات' },
          ...list.map(b => ({ value: b.id, label: b.name })),
        ])
      })
      .finally(() => setGovernoratesLoading(false))
  }, [])

  const load = useCallback(async (term: string, offset = 0, append = false) => {
    if (!branchId && !viewAllBranches) {
      setRows([])
      setTotal(0)
      setLoading(false)
      return
    }
    if (append) setLoadingMore(true)
    else setLoading(true)

    const res = await fetchPaymentInProgressDebtors(createClient(), scopeBranch, {
      search: term,
      offset,
      limit: PAGE_SIZE,
      branchListId: scopeListId,
      caseType: caseTypeFilter,
    })
    setRows(prev => (append ? [...prev, ...res.rows] : res.rows))
    setTotal(res.total)

    if (allowNoncompliance && res.rows.length) {
      const map = await fetchPendingNoncomplianceByDebtorIds(
        createClient(),
        res.rows.map(r => r.id),
      )
      if (append) {
        setPendingRequestByDebtor(prev => {
          const next = new Map(prev)
          map.forEach((v, k) => next.set(k, v))
          return next
        })
      } else {
        setPendingRequestByDebtor(map)
      }
    } else if (!append) {
      setPendingRequestByDebtor(new Map())
    }

    setLoading(false)
    setLoadingMore(false)
  }, [branchId, viewAllBranches, scopeBranch, scopeListId, allowNoncompliance, caseTypeFilter])

  useEffect(() => { void load(search) }, [load])

  function handleSearch(val: string) {
    setSearch(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { void load(val) }, 300)
  }

  async function handleGovernorateChange(value: string) {
    if (switchingGov) return
    setSwitchingGov(true)
    try {
      if (!value) {
        const res = await fetch('/api/admin/set-branch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ viewAll: true }),
        })
        if (res.ok) {
          setViewAllBranches()
          refreshAdminNotifications()
        }
      } else {
        const label = govOptions.find(o => o.value === value)?.label ?? ''
        const res = await fetch('/api/admin/set-branch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branchId: value }),
        })
        if (res.ok) {
          setBranch(value, label)
          refreshAdminNotifications()
        }
      }
    } finally {
      setSwitchingGov(false)
    }
  }

  async function refreshAfterPayment() {
    setPayFor(null)
    await load(search)
  }

  const hasMore = rows.length < total
  const govValue = viewAllBranches ? ALL_GOVS : (branchId ?? ALL_GOVS)

  return (
    <div className="space-y-5">
      <PageHeader
        title="جاري التسديد"
        subtitle={followUpOnly
          ? 'متابعة تحصيل المدينين في كل المحافظات'
          : `${total} مدين في جاري التسديد`}
      />

      <div className="bg-white rounded-xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PremiumSelect
            value={govValue}
            onChange={v => void handleGovernorateChange(v)}
            options={govOptions}
            placeholder={governoratesLoading ? 'جارٍ تحميل المحافظات...' : '— اختر المحافظة —'}
            fieldLabel="المحافظة"
            headerTitle="تصفية حسب المحافظة"
            headerSubtitle="كل المحافظات أو محافظة محددة"
            searchPlaceholder="بحث في المحافظات..."
            disabled={switchingGov || governoratesLoading}
            menuPortal
          />
          <div>
            <label className="block text-xs font-bold text-[#231F20] mb-1.5">بحث بالاسم</label>
            <input
              type="text"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              placeholder="بحث بالاسم..."
              className="w-full text-sm rounded-xl border border-[rgba(118,118,118,0.2)] px-3.5 py-2.5 focus:outline-none focus:border-[#2C8780]"
            />
          </div>
        </div>

        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-[rgba(118,118,118,0.07)] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-semibold text-[#231F20]">
              {search ? 'لا نتائج' : 'لا توجد أسماء في جاري التسديد'}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-xs text-[#767676] border-b border-[rgba(118,118,118,0.1)]">
                    <th className="px-4 py-2.5 font-semibold">الاسم</th>
                    {showBranchCol && <th className="px-4 py-2.5 font-semibold">المحافظة</th>}
                    <th className="px-4 py-2.5 font-semibold">المتبقي</th>
                    <th className="px-4 py-2.5 font-semibold">المسدد</th>
                    <th className="px-4 py-2.5 font-semibold">آخر تسديد</th>
                    <th className="px-4 py-2.5 font-semibold text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(118,118,118,0.06)]">
                  {rows.map(r => (
                    <tr key={r.id} className="hover:bg-[#FAFAFA]">
                      <td className="px-4 py-3">
                        <Link href={`/admin/debtors/${r.id}/account`} className="font-semibold text-[#231F20] hover:text-[#2C8780]">
                          {r.full_name}
                        </Link>
                      </td>
                      {showBranchCol && (
                        <td className="px-4 py-3 text-xs text-[#767676]">{r.branch_name ?? '—'}</td>
                      )}
                      <td className="px-4 py-3 font-semibold tabular-nums text-red-600" dir="ltr">{fmtMoney(r.remaining_amount)}</td>
                      <td className="px-4 py-3 tabular-nums" dir="ltr">{fmtMoney(r.total_payments)}</td>
                      <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtDate(r.last_payment_date)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2 flex-wrap">
                          <Link
                            href={`/admin/debtors/${r.id}/account`}
                            className="text-xs border border-[rgba(118,118,118,0.2)] px-2.5 py-1.5 rounded-lg hover:border-[#2C8780]/40"
                          >
                            فتح الملف
                          </Link>
                          {allowPay && (
                            <button
                              type="button"
                              onClick={() => setPayFor(r)}
                              className="text-xs text-white px-2.5 py-1.5 rounded-lg font-semibold"
                              style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                            >
                              تسجيل تسديد
                            </button>
                          )}
                          {allowNoncompliance && (
                            pendingRequestByDebtor.has(r.id) ? (
                              <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg font-semibold">
                                طلب قيد المراجعة
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setNoncomplianceFor(r)}
                                className="text-xs text-[#231F20] border border-[rgba(118,118,118,0.25)] hover:border-amber-400 hover:bg-amber-50 px-2.5 py-1.5 rounded-lg font-semibold"
                              >
                                طلب عدم التزام
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
              {rows.map(r => (
                <div key={r.id} className="p-4 space-y-2">
                  <Link href={`/admin/debtors/${r.id}/account`} className="font-semibold text-[#231F20] block">
                    {r.full_name}
                  </Link>
                  {r.branch_name && <p className="text-xs text-[#2C8780]">{r.branch_name}</p>}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-[#767676]">المتبقي</p>
                      <p className="font-semibold text-red-600 tabular-nums" dir="ltr">{fmtMoney(r.remaining_amount)}</p>
                    </div>
                    <div>
                      <p className="text-[#767676]">آخر تسديد</p>
                      <p className="tabular-nums" dir="ltr">{fmtDate(r.last_payment_date)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap pt-1">
                    <Link
                      href={`/admin/debtors/${r.id}/account`}
                      className="flex-1 text-center text-xs border border-[rgba(118,118,118,0.2)] px-3 py-1.5 rounded-lg"
                    >
                      فتح الملف
                    </Link>
                    {allowPay && (
                      <button
                        type="button"
                        onClick={() => setPayFor(r)}
                        className="flex-1 text-xs text-white px-3 py-1.5 rounded-lg font-semibold"
                        style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                      >
                        تسجيل تسديد
                      </button>
                    )}
                    {allowNoncompliance && (
                      pendingRequestByDebtor.has(r.id) ? (
                        <span className="flex-1 text-center text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg font-semibold">
                          طلب قيد المراجعة
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setNoncomplianceFor(r)}
                          className="flex-1 text-xs text-[#231F20] border border-[rgba(118,118,118,0.25)] px-3 py-1.5 rounded-lg font-semibold"
                        >
                          طلب عدم التزام
                        </button>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between px-4 py-3 border-t border-[rgba(118,118,118,0.08)]">
              <p className="text-xs text-[#767676]">عرض {rows.length} من {total}</p>
              {hasMore && (
                <button
                  type="button"
                  onClick={() => void load(search, rows.length, true)}
                  disabled={loadingMore}
                  className="text-xs font-semibold text-[#2C8780] border border-[#2C8780]/30 px-4 py-2 rounded-lg disabled:opacity-60"
                >
                  {loadingMore ? '...' : 'عرض المزيد'}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {payFor && (
        <DebtorPaymentModal
          open
          onClose={() => setPayFor(null)}
          debtorId={payFor.id}
          debtorName={payFor.full_name}
          receiptNumber={null}
          remainingAmount={payFor.remaining_amount}
          branchId={payFor.branch_id}
          onSaved={() => void refreshAfterPayment()}
        />
      )}
      {noncomplianceFor && (
        <SendNoncomplianceRequestModal
          open
          debtorId={noncomplianceFor.id}
          debtorName={noncomplianceFor.full_name}
          onClose={() => setNoncomplianceFor(null)}
          onSuccess={async () => {
            setNoncomplianceFor(null)
            await appAlert({
              title: 'تم الإرسال',
              message: 'أُرسل طلب عدم الالتزام بنجاح. المدين يبقى في جاري التسديد حتى تتم المراجعة.',
              variant: 'success',
            })
            await load(search)
          }}
        />
      )}
    </div>
  )
}
