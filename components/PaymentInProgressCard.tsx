'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAdminRole } from '@/context/admin-role'
import { canViewPaymentInProgressCard } from '@/lib/permissions'
import { fmtDate, fmtMoney } from '@/lib/utils'
import BranchListBox from '@/components/BranchListBox'
import {
  fetchPaymentInProgressBranchSummaries,
  fetchPaymentInProgressDebtors,
  type PaymentBranchSummary,
  type PaymentInProgressDebtor,
} from '@/lib/payment-in-progress'
import { useCaseScope } from '@/hooks/use-case-scope'

const PAGE_SIZE = 20

interface Props {
  branchId: string | null
  viewAllBranches: boolean
  listId?: string | null
  hideHeader?: boolean
}

function BranchPaymentBox({
  summary,
  caseTypeFilter,
  initialListId,
}: {
  summary: PaymentBranchSummary
  caseTypeFilter: 'civil' | 'criminal' | null
  initialListId: string
}) {
  const [listId, setListId] = useState(initialListId)
  const [rows, setRows] = useState<PaymentInProgressDebtor[]>([])
  const [total, setTotal] = useState(summary.count)
  const [loading, setLoading] = useState(true)

  useEffect(() => { setListId(initialListId) }, [initialListId, summary.branchId])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetchPaymentInProgressDebtors(createClient(), summary.branchId, {
      limit: PAGE_SIZE,
      branchListId: listId || null,
      caseType: caseTypeFilter,
    })
    setRows(res.rows)
    setTotal(res.total)
    setLoading(false)
  }, [summary.branchId, listId, caseTypeFilter])

  useEffect(() => { void load() }, [load])

  if (!loading && total === 0 && !listId) return null

  return (
    <BranchListBox
      branchId={summary.branchId}
      branchName={summary.branchName}
      count={total}
      listId={listId}
      onListChange={setListId}
      loadingCount={loading && rows.length === 0}
    >
      {loading && rows.length === 0 ? (
        <div className="p-4 space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-10 bg-[rgba(118,118,118,0.07)] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-[#767676]">لا أسماء في هذه القائمة</div>
      ) : (
        <>
          <div className="hidden md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-xs text-[#767676] border-b border-[rgba(118,118,118,0.1)]">
                  <th className="px-4 py-2.5 font-semibold">الاسم</th>
                  <th className="px-4 py-2.5 font-semibold">المتبقي</th>
                  <th className="px-4 py-2.5 font-semibold">آخر تسديد</th>
                  <th className="px-4 py-2.5 font-semibold text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(118,118,118,0.06)]">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-[#FAFAFA]">
                    <td className="px-4 py-3 font-semibold text-[#231F20]">{r.full_name}</td>
                    <td className="px-4 py-3 tabular-nums" dir="ltr">{fmtMoney(r.remaining_amount)}</td>
                    <td className="px-4 py-3 text-xs tabular-nums" dir="ltr">{fmtDate(r.last_payment_date)}</td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={`/admin/debtors/${r.id}/account`}
                        className="text-xs text-[#231F20] hover:text-[#2C8780] border border-[rgba(118,118,118,0.2)] hover:border-[#2C8780]/40 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                      >
                        فتح الملف
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden divide-y divide-[rgba(118,118,118,0.08)]">
            {rows.map(r => (
              <div key={r.id} className="p-4">
                <p className="font-semibold text-[#231F20] mb-2">{r.full_name}</p>
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div>
                    <p className="text-[#767676]">المتبقي</p>
                    <p className="font-semibold tabular-nums" dir="ltr">{fmtMoney(r.remaining_amount)}</p>
                  </div>
                  <div>
                    <p className="text-[#767676]">آخر تسديد</p>
                    <p className="tabular-nums" dir="ltr">{fmtDate(r.last_payment_date)}</p>
                  </div>
                </div>
                <Link
                  href={`/admin/debtors/${r.id}/account`}
                  className="block text-center text-xs text-[#231F20] border border-[rgba(118,118,118,0.2)] px-3 py-1.5 rounded-lg"
                >
                  فتح الملف
                </Link>
              </div>
            ))}
          </div>
          {total > rows.length && (
            <p className="px-4 py-3 text-xs text-[#767676] border-t border-[rgba(118,118,118,0.08)]">
              عرض {rows.length} من {total}
            </p>
          )}
        </>
      )}
    </BranchListBox>
  )
}

export default function PaymentInProgressCard({ branchId, viewAllBranches, listId = null, hideHeader }: Props) {
  const role = useAdminRole()
  const { caseTypeFilter } = useCaseScope()
  const allowed = canViewPaymentInProgressCard(role)
  const [branches, setBranches] = useState<PaymentBranchSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [grandTotal, setGrandTotal] = useState(0)

  const scopeBranchId = viewAllBranches ? null : branchId

  const load = useCallback(async () => {
    if (!allowed) return
    if (!branchId && !viewAllBranches) {
      setBranches([])
      setGrandTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    const res = await fetchPaymentInProgressBranchSummaries(createClient(), scopeBranchId, {
      caseType: caseTypeFilter,
    })
    setBranches(res.branches)
    setGrandTotal(res.branches.reduce((s, b) => s + b.count, 0))
    setLoading(false)
  }, [allowed, branchId, viewAllBranches, scopeBranchId, caseTypeFilter])

  useEffect(() => { void load() }, [load])

  if (!allowed) return null
  if (!branchId && !viewAllBranches) return null

  const initialListForBox = viewAllBranches ? '' : (listId ?? '')

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2.5">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">جاري التسديد</h2>
            <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-[#2C8780]/15 text-[#1D6365] text-sm font-black tabular-nums">
              {loading ? '—' : grandTotal}
            </span>
          </div>
          <span className="hidden sm:inline text-sm text-[#454042] font-medium">متابعة تحصيل الأقساط</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-32 bg-white rounded-2xl border animate-pulse" />
          ))}
        </div>
      ) : branches.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] px-4 py-10 text-center">
          <p className="text-sm font-semibold text-[#231F20]">لا توجد أسماء في جاري التسديد حالياً</p>
        </div>
      ) : (
        <div className="space-y-4">
          {branches.map(b => (
            <BranchPaymentBox
              key={b.branchId}
              summary={b}
              caseTypeFilter={caseTypeFilter}
              initialListId={initialListForBox}
            />
          ))}
        </div>
      )}
    </div>
  )
}
