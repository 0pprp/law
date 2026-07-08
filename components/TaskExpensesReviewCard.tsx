'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtMoney } from '@/lib/utils'
import type { TaskExpenseRow } from '@/lib/expense-wallet'

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  approved:         { label: 'معتمدة',           cls: 'bg-green-100 text-green-700' },
  pending_review:   { label: 'مع الإنجاز',       cls: 'bg-yellow-100 text-yellow-700' },
  pending_approval: { label: 'مع الإنجاز',       cls: 'bg-yellow-100 text-yellow-700' },
  pending:          { label: 'مع الإنجاز',       cls: 'bg-yellow-100 text-yellow-700' },
  rejected:         { label: 'مرفوضة',           cls: 'bg-red-100 text-red-700' },
}

export default function TaskExpensesReviewCard({ taskId }: { taskId: string }) {
  const [expenses, setExpenses] = useState<TaskExpenseRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('expenses')
      .select('id, amount, expense_type, description, status, max_allowed_amount, wallet_deducted_at')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setExpenses((data ?? []) as TaskExpenseRow[])
        setLoaded(true)
      })
  }, [taskId])

  if (!loaded) return <p className="text-sm text-[#767676]">جارٍ تحميل الصرفيات...</p>
  if (!expenses.length) {
    return (
      <div className="border border-[rgba(118,118,118,0.15)] rounded-xl px-4 py-3">
        <p className="text-sm text-[#767676] italic">لا توجد صرفيات مسجّلة لهذه المهمة</p>
      </div>
    )
  }

  const pendingTotal = expenses
    .filter(e => !e.wallet_deducted_at && ['pending_review', 'pending_approval', 'pending'].includes(e.status ?? ''))
    .reduce((s, e) => s + Number(e.amount ?? 0), 0)

  return (
    <div className="border border-sky-200 rounded-xl overflow-hidden">
      <div className="bg-sky-50 px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-bold text-sky-900">صرفيات المهمة ({expenses.length})</span>
        {pendingTotal > 0 && (
          <span className="text-xs font-bold text-yellow-700 bg-yellow-100 px-2.5 py-1 rounded-full">
            ستُخصم عند الاعتماد: {fmtMoney(pendingTotal)}
          </span>
        )}
      </div>
      <div className="divide-y divide-[rgba(118,118,118,0.08)]">
        {expenses.map(exp => {
          const s = exp.status ?? 'pending_review'
          const badge = STATUS_BADGE[s] ?? STATUS_BADGE.pending_review
          return (
            <div key={exp.id} className="px-4 py-3 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm leading-relaxed">
                  <span className="text-[#767676] font-semibold">نوع الصرفية: </span>
                  <span className="font-bold text-[#231F20]">{exp.expense_type ?? 'صرفية'}</span>
                </p>
                {exp.description && (
                  <p className="text-sm leading-relaxed">
                    <span className="text-[#767676] font-semibold">ملاحظة: </span>
                    <span className="font-semibold text-[#231F20]">{exp.description}</span>
                  </p>
                )}
                {exp.max_allowed_amount != null && (
                  <p className="text-sm leading-relaxed">
                    <span className="text-[#767676] font-semibold">الحد الأقصى: </span>
                    <span className="font-semibold text-sky-700" dir="ltr">{fmtMoney(Number(exp.max_allowed_amount))}</span>
                  </p>
                )}
                <p className="text-sm flex items-center gap-2 flex-wrap">
                  <span className="text-[#767676] font-semibold">الحالة:</span>
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${badge.cls}`}>
                    {badge.label}
                  </span>
                </p>
              </div>
              <div className="shrink-0 text-left">
                <p className="text-xs text-[#767676] font-semibold mb-0.5">المبلغ</p>
                <p className="text-base font-black text-sky-700 tabular-nums" dir="ltr">
                  {fmtMoney(Number(exp.amount))}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      {pendingTotal > 0 && (
        <p className="text-xs text-sky-700 px-4 py-2.5 bg-sky-50/30 border-t border-sky-100 leading-relaxed">
          عند اعتماد الإنجاز تُخصم من محفظة صرفيات المحامي — تأكد من كفاية الرصيد
        </p>
      )}
    </div>
  )
}
