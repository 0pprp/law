'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { logActivity } from '@/lib/activity-log'
import { formatMoney } from '@/lib/money-input'
import { syncDebtorRemainingAfterPayments } from '@/lib/debtor-balances'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { canDelete, PERMISSION_DENIED_MSG } from '@/lib/permissions'
import { useAdminRole } from '@/context/admin-role'

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

  async function deletePayment(payment: DebtorPaymentRow) {
    if (!allowDelete) {
      setError(PERMISSION_DENIED_MSG)
      return
    }
    if (!confirm(`حذف تسديد ${fmtMoney(Number(payment.amount))}؟\nسيُعاد المبلغ إلى المتبقي.`)) return

    setDeletingId(payment.id)
    setError('')
    const supabase = createClient()

    const { error: delErr } = await supabase.from('debtor_payments').delete().eq('id', payment.id)
    if (delErr) {
      setError(delErr.message)
      setDeletingId(null)
      return
    }

    const syncResult = await syncDebtorRemainingAfterPayments(supabase, debtorId)
    if (!syncResult.ok) {
      setError(syncResult.error ?? 'فشل تحديث المتبقي')
      setDeletingId(null)
      return
    }

    await logActivity(
      {
        action: 'delete_payment',
        entity_type: 'payment',
        entity_id: payment.id,
        description: `حذف تسديد: ${formatMoney(Number(payment.amount))} — ${debtorName}`,
      },
      supabase,
    )

    setPayments(prev => prev.filter(p => p.id !== payment.id))
    setDeletingId(null)
    router.refresh()
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
        <div className="divide-y divide-[rgba(118,118,118,0.08)]">
          {payments.map(p => (
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
      )}
    </div>
  )
}
