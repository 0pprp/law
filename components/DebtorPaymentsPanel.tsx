'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatMoney } from '@/lib/money-input'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { canDelete, PERMISSION_DENIED_MSG } from '@/lib/permissions'
import { appConfirm } from '@/lib/app-dialog'
import { useAdminRole } from '@/context/admin-role'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'

export interface DebtorPaymentRow {
  id: string
  amount: number
  notes?: string | null
  payment_date: string
}

interface Props {
  debtorId: string
  debtorName: string
  initialPayments: DebtorPaymentRow[]
}

export default function DebtorPaymentsPanel({ debtorId, debtorName, initialPayments }: Props) {
  const router = useRouter()
  const role = useAdminRole()
  const allowDelete = canDelete(role)
  const [payments, setPayments] = useState(initialPayments)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const total = payments.reduce((s, p) => s + Number(p.amount), 0)
  const { visibleItems, expanded, toggle, hasMore, total: paymentCount } = useShowMore(payments, LOG_PREVIEW_LIMIT)

  async function deletePayment(payment: DebtorPaymentRow) {
    if (!allowDelete) {
      setError(PERMISSION_DENIED_MSG)
      return
    }
    const ok = await appConfirm({
      title: 'تأكيد الحذف',
      message: `حذف تسديد ${fmtMoney(Number(payment.amount))}؟\nسيُعاد المبلغ إلى المتبقي.`,
      confirmLabel: 'حذف',
      danger: true,
    })
    if (!ok) return

    setDeletingId(payment.id)
    setError('')
    try {
      const res = await fetch(`/api/admin/payments/${payment.id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setError(typeof data.error === 'string' ? data.error : 'فشل حذف الدفعة')
        setDeletingId(null)
        return
      }
      setPayments(prev => prev.filter(p => p.id !== payment.id))
      router.refresh()
    } catch {
      setError('فشل حذف الدفعة')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <div className="px-5 py-3 border-b border-[rgba(118,118,118,0.08)] flex items-center justify-between gap-3">
        <span className="text-sm font-black text-emerald-700 tabular-nums" dir="ltr">{fmtMoney(total)}</span>
      </div>

      {error && (
        <div className="mx-5 mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {!payments.length ? (
        <div className="py-8 text-center text-[#767676] text-sm">لا توجد تسديدات</div>
      ) : (
        <>
          <div className="divide-y divide-[rgba(118,118,118,0.08)]">
            {visibleItems.map(p => (
            <div key={p.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-emerald-700 tabular-nums" dir="ltr">
                  {fmtMoney(Number(p.amount))}
                </p>
                <p className="text-xs text-[#767676] mt-0.5">{p.notes || '—'}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-[#767676] font-mono" dir="ltr">{fmtDate(p.payment_date)}</span>
                {allowDelete && (
                  <button
                    type="button"
                    onClick={() => deletePayment(p)}
                    disabled={deletingId === p.id}
                    className="text-xs text-red-600 hover:text-red-800 border border-red-200 hover:border-red-300 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {deletingId === p.id ? '...' : 'حذف'}
                  </button>
                )}
              </div>
            </div>
            ))}
          </div>
          <ShowMoreFooter hasMore={hasMore} expanded={expanded} onToggle={toggle} total={paymentCount} />
        </>
      )}
    </div>
  )
}
