'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAdminRole } from '@/context/admin-role'
import { canReviewPaymentNoncomplianceRequest } from '@/lib/permissions'
import { fmtDate } from '@/lib/utils'
import { appAlert } from '@/lib/app-dialog'
import BranchListBox from '@/components/BranchListBox'
import {
  fetchPendingNoncomplianceBranchSummaries,
  fetchPendingNoncomplianceRequests,
  type NoncomplianceBranchSummary,
  type PendingNoncomplianceRow,
} from '@/lib/payment-noncompliance'
import { useCaseScope } from '@/hooks/use-case-scope'
import { PremiumSelect } from '@/components/ui/premium-select'
import { CASE_TYPE_FILTER_OPTIONS } from '@/lib/case-type'
import { createClient } from '@/lib/supabase/client'

interface Props {
  branchId: string | null
  viewAllBranches: boolean
  listId?: string | null
  onChanged?: () => void
  hideHeader?: boolean
}

function BranchNoncomplianceBox({
  summary,
  caseType,
  initialListId,
  busyId,
  onApprove,
  onReject,
}: {
  summary: NoncomplianceBranchSummary
  caseType: 'civil' | 'criminal' | null
  initialListId: string
  busyId: string | null
  onApprove: (r: PendingNoncomplianceRow) => void
  onReject: (r: PendingNoncomplianceRow) => void
}) {
  const [listId, setListId] = useState(initialListId)
  const [rows, setRows] = useState<PendingNoncomplianceRow[]>([])
  const [total, setTotal] = useState(summary.count)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { setListId(initialListId) }, [initialListId, summary.branchId])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const res = await fetchPendingNoncomplianceRequests(createClient(), summary.branchId, {
      limit: 50,
      branchListId: listId || null,
      caseType,
    })
    if (res.error) {
      setError(res.error)
      setRows([])
      setTotal(0)
    } else {
      setRows(res.rows)
      setTotal(res.total)
    }
    setLoading(false)
  }, [summary.branchId, listId, caseType])

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
      {error && (
        <div className="mx-4 mt-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}
      {loading && rows.length === 0 ? (
        <div className="p-4 space-y-2">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-10 bg-[rgba(118,118,118,0.07)] rounded-xl animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-[#767676]">لا طلبات في هذه القائمة</div>
      ) : (
        <div className="divide-y divide-[rgba(118,118,118,0.08)]">
          {rows.map(r => (
            <div key={r.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="min-w-0 space-y-0.5">
                <p className="font-semibold text-[#231F20]">{r.debtor_name}</p>
                <p className="text-xs text-[#767676]">
                  {[r.requester_name ? `من: ${r.requester_name}` : null, fmtDate(r.created_at)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {r.note && <p className="text-xs text-[#454042] mt-1">{r.note}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={!!busyId}
                  onClick={() => onApprove(r)}
                  className="text-xs font-bold text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                >
                  {busyId === r.id ? '...' : 'موافقة'}
                </button>
                <button
                  type="button"
                  disabled={!!busyId}
                  onClick={() => onReject(r)}
                  className="text-xs font-semibold text-red-600 border border-red-200 bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  رفض
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </BranchListBox>
  )
}

export default function PaymentNoncomplianceRequestsCard({
  branchId,
  viewAllBranches,
  listId = null,
  onChanged,
  hideHeader,
}: Props) {
  const role = useAdminRole()
  const { caseTypeFilter: lockedCaseType } = useCaseScope()
  const [filterCaseType, setFilterCaseType] = useState<'' | 'civil' | 'criminal'>(lockedCaseType ?? '')
  const effectiveCaseType = lockedCaseType ?? (filterCaseType || null)
  const allowed = canReviewPaymentNoncomplianceRequest(role)
  const [branches, setBranches] = useState<NoncomplianceBranchSummary[]>([])
  const [grandTotal, setGrandTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectFor, setRejectFor] = useState<PendingNoncomplianceRow | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    setFilterCaseType(lockedCaseType ?? '')
  }, [lockedCaseType])

  const scopeBranchId = viewAllBranches ? null : branchId

  const loadSummaries = useCallback(async () => {
    if (!allowed) return
    if (!branchId && !viewAllBranches) {
      setBranches([])
      setGrandTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    const res = await fetchPendingNoncomplianceBranchSummaries(createClient(), scopeBranchId, {
      caseType: effectiveCaseType,
    })
    if (res.error) {
      setError(res.error)
      setBranches([])
      setGrandTotal(0)
    } else {
      setBranches(res.branches)
      setGrandTotal(res.branches.reduce((s, b) => s + b.count, 0))
    }
    setLoading(false)
  }, [allowed, branchId, viewAllBranches, scopeBranchId, effectiveCaseType, reloadKey])

  useEffect(() => { void loadSummaries() }, [loadSummaries])

  async function approve(row: PendingNoncomplianceRow) {
    if (busyId) return
    setBusyId(row.id)
    setError('')
    try {
      const res = await fetch('/api/admin/payment-noncompliance/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: row.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل الموافقة')
        setBusyId(null)
        return
      }
      await appAlert({
        title: 'تمت الموافقة',
        message: `تم إرجاع «${row.debtor_name}» إلى آخر مهمة بحالة غير مكلفة.`,
        variant: 'success',
      })
      setBusyId(null)
      setReloadKey(k => k + 1)
      onChanged?.()
    } catch {
      setError('فشل الاتصال')
      setBusyId(null)
    }
  }

  async function confirmReject() {
    if (!rejectFor || busyId) return
    setBusyId(rejectFor.id)
    setError('')
    try {
      const res = await fetch('/api/admin/payment-noncompliance/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestId: rejectFor.id,
          rejectionReason: rejectReason.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل الرفض')
        setBusyId(null)
        return
      }
      const name = rejectFor.debtor_name
      setRejectFor(null)
      setRejectReason('')
      await appAlert({
        title: 'تم الرفض',
        message: `رُفض طلب عدم الالتزام لـ «${name}». يبقى المدين في جاري التسديد.`,
        variant: 'info',
      })
      setBusyId(null)
      setReloadKey(k => k + 1)
      onChanged?.()
    } catch {
      setError('فشل الاتصال')
      setBusyId(null)
    }
  }

  if (!allowed) return null
  if (!branchId && !viewAllBranches) return null

  const initialListForBox = viewAllBranches ? '' : (listId ?? '')

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <div className="flex items-center gap-2.5">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">طلبات عدم الالتزام</h2>
            <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-amber-100 text-amber-800 text-sm font-black tabular-nums">
              {loading ? '—' : grandTotal}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!lockedCaseType && (
              <div className="w-36">
                <PremiumSelect
                  value={filterCaseType}
                  onChange={v => setFilterCaseType(v === 'civil' || v === 'criminal' ? v : '')}
                  options={CASE_TYPE_FILTER_OPTIONS.map(o => ({ value: o.value, label: o.label }))}
                />
              </div>
            )}
            <span className="hidden sm:inline text-sm text-[#454042] font-medium">معلّقة من متابعة التسديد</span>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-32 bg-white rounded-2xl border animate-pulse" />
          ))}
        </div>
      ) : branches.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] px-4 py-10 text-center">
          <p className="text-sm font-semibold text-[#231F20]">لا توجد طلبات معلّقة حالياً</p>
        </div>
      ) : (
        <div className="space-y-4">
          {branches.map(b => (
            <BranchNoncomplianceBox
              key={`${b.branchId}-${reloadKey}`}
              summary={b}
              caseType={effectiveCaseType}
              initialListId={initialListForBox}
              busyId={busyId}
              onApprove={r => void approve(r)}
              onReject={r => { setRejectFor(r); setRejectReason('') }}
            />
          ))}
        </div>
      )}

      {rejectFor && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          style={{ background: 'rgba(35,31,32,0.7)', backdropFilter: 'blur(3px)' }}
          dir="rtl"
        >
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-5 space-y-4">
            <div>
              <h3 className="text-base font-black text-[#231F20]">رفض طلب عدم الالتزام</h3>
              <p className="text-sm text-[#767676] mt-1">
                المدين: <span className="font-bold text-[#231F20]">{rejectFor.debtor_name}</span>
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold text-[#231F20] mb-1.5">سبب الرفض (اختياري)</label>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                rows={3}
                disabled={!!busyId}
                className="w-full text-sm rounded-xl border border-[rgba(118,118,118,0.2)] px-3.5 py-2.5 focus:outline-none focus:border-[#2C8780] resize-none disabled:opacity-60"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void confirmReject()}
                disabled={!!busyId}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-red-600 disabled:opacity-50"
              >
                {busyId === rejectFor.id ? '...' : 'تأكيد الرفض'}
              </button>
              <button
                type="button"
                disabled={!!busyId}
                onClick={() => { setRejectFor(null); setRejectReason('') }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-[#767676] border border-[rgba(118,118,118,0.2)] disabled:opacity-50"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
