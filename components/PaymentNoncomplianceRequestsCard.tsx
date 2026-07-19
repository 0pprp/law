'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAdminRole } from '@/context/admin-role'
import { canReviewPaymentNoncomplianceRequest } from '@/lib/permissions'
import { fmtDate } from '@/lib/utils'
import { appAlert } from '@/lib/app-dialog'
import type { PendingNoncomplianceRow } from '@/lib/payment-noncompliance'

interface Props {
  branchId: string | null
  viewAllBranches: boolean
  onChanged?: () => void
  /** إخفاء ترويسة الكارد عند استخدامه داخل صفحة لها PageHeader */
  hideHeader?: boolean
}

export default function PaymentNoncomplianceRequestsCard({
  branchId,
  viewAllBranches,
  onChanged,
  hideHeader,
}: Props) {
  const role = useAdminRole()
  const allowed = canReviewPaymentNoncomplianceRequest(role)
  const [rows, setRows] = useState<PendingNoncomplianceRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectFor, setRejectFor] = useState<PendingNoncomplianceRow | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = useCallback(async () => {
    if (!allowed) return
    if (!branchId && !viewAllBranches) {
      setRows([])
      setTotal(0)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '30' })
      if (viewAllBranches) params.set('viewAll', '1')
      else if (branchId) params.set('branchId', branchId)
      const res = await fetch(`/api/admin/payment-noncompliance?${params}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json.error === 'string' ? json.error : 'فشل تحميل الطلبات')
        setRows([])
        setTotal(0)
      } else {
        setRows(json.rows ?? [])
        setTotal(json.total ?? 0)
      }
    } catch {
      setError('فشل الاتصال')
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [allowed, branchId, viewAllBranches])

  useEffect(() => { void load() }, [load])

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
      await load()
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
      await load()
      onChanged?.()
    } catch {
      setError('فشل الاتصال')
      setBusyId(null)
    }
  }

  if (!allowed) return null
  if (!branchId && !viewAllBranches) return null

  return (
    <div>
      {!hideHeader && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <h2 className="font-black text-[#231F20] text-base sm:text-lg">طلبات عدم الالتزام</h2>
            <span className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full bg-amber-100 text-amber-800 text-sm font-black tabular-nums">
              {loading ? '—' : total}
            </span>
          </div>
          <span className="hidden sm:inline text-sm text-[#454042] font-medium">معلّقة من متابعة التسديد</span>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-[rgba(118,118,118,0.15)] shadow-sm overflow-hidden">
        {error && (
          <div className="mx-4 mt-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
        )}
        {loading ? (
          <div className="p-4 space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-[rgba(118,118,118,0.07)] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold text-[#231F20]">لا توجد طلبات معلّقة حالياً</p>
          </div>
        ) : (
          <div className="divide-y divide-[rgba(118,118,118,0.08)]">
            {rows.map(r => (
              <div key={r.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <div className="min-w-0 space-y-0.5">
                  <p className="font-semibold text-[#231F20]">{r.debtor_name}</p>
                  <p className="text-xs text-[#767676]">
                    {[r.branch_name, r.requester_name ? `من: ${r.requester_name}` : null, fmtDate(r.created_at)]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {r.note && <p className="text-xs text-[#454042] mt-1">{r.note}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={!!busyId}
                    onClick={() => void approve(r)}
                    className="text-xs font-bold text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg,#2C8780,#1D6365)' }}
                  >
                    {busyId === r.id ? '...' : 'موافقة'}
                  </button>
                  <button
                    type="button"
                    disabled={!!busyId}
                    onClick={() => { setRejectFor(r); setRejectReason('') }}
                    className="text-xs font-semibold text-red-600 border border-red-200 bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50"
                  >
                    رفض
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
