'use client'

import { TASK_TYPE_LABELS } from '@/lib/types'
import type { TaskType } from '@/lib/types'
import { fmtMoney, fmtDate } from '@/lib/utils'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'

export interface DebtorExpenseRow {
  id: string
  amount: number
  status?: string | null
  expense_type?: string | null
  description?: string | null
  expense_date: string
  task?: { task_type?: string | null } | null
}

export default function DebtorExpensesList({ expenses }: { expenses: DebtorExpenseRow[] }) {
  const { visibleItems, expanded, toggle, hasMore, total } = useShowMore(expenses, LOG_PREVIEW_LIMIT)

  if (!expenses.length) {
    return <div className="py-8 text-center text-[#767676] text-sm">لا توجد صرفيات</div>
  }

  return (
    <>
      <div className="divide-y divide-[rgba(118,118,118,0.08)]">
        {visibleItems.map(e => {
          const s = e.status ?? 'approved'
          const isPending = s === 'pending_approval'
          const isRejected = s === 'rejected'
          return (
            <div key={e.id} className={`px-5 py-3.5 flex items-center justify-between gap-4 ${isPending ? 'opacity-60' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-semibold tabular-nums ${isRejected ? 'text-[#767676] line-through' : 'text-red-600'}`} dir="ltr">
                    {fmtMoney(Number(e.amount))}
                  </p>
                  {isPending && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700">بانتظار الاعتماد</span>}
                  {isRejected && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">مرفوضة</span>}
                </div>
                <p className="text-xs text-[#767676] mt-0.5">
                  {[e.expense_type, e.description, e.task?.task_type ? TASK_TYPE_LABELS[e.task.task_type as TaskType] : null].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <span className="text-xs text-[#767676] font-mono shrink-0" dir="ltr">{fmtDate(e.expense_date)}</span>
            </div>
          )
        })}
      </div>
      <ShowMoreFooter hasMore={hasMore} expanded={expanded} onToggle={toggle} total={total} />
    </>
  )
}
