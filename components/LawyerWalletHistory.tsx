'use client'

import { fmtMoney, fmtDate } from '@/lib/utils'
import type { WalletTransactionType, LawyerWalletKind } from '@/lib/types'
import type { LawyerWalletRow } from '@/lib/lawyer-wallet'
import {
  walletTransactionLabel,
  walletTransactionIconKind,
  WalletTransactionIcon,
  walletIconColors,
} from '@/lib/wallet-transaction-display'
import { LOG_PREVIEW_LIMIT, ShowMoreFooter, useShowMore } from '@/components/ui/show-more'

interface Props {
  title: string
  transactions: LawyerWalletRow[]
  emptyMessage?: string
  initialLimit?: number
}

export default function LawyerWalletHistory({
  title,
  transactions,
  emptyMessage = 'لا توجد حركات بعد',
  initialLimit = LOG_PREVIEW_LIMIT,
}: Props) {
  const { visibleItems, expanded, toggle, hasMore, total } = useShowMore(transactions, initialLimit)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 pt-4 pb-2 border-b border-slate-100">
        <p className="text-xs font-bold text-slate-400">{title}</p>
      </div>
      {transactions.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">{emptyMessage}</p>
      ) : (
        <>
          <div className="divide-y divide-slate-100">
            {visibleItems.map(tx => {
              const amt = Number(tx.amount)
              const wallet = (tx.wallet ?? 'fees') as LawyerWalletKind
              const iconKind = walletTransactionIconKind(tx.type as WalletTransactionType, wallet, amt)
              const colors = walletIconColors(iconKind, amt, wallet)
              return (
                <div key={tx.id} className="px-4 py-3 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${colors}`}>
                    <WalletTransactionIcon kind={iconKind} className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-black tabular-nums ${amt > 0 ? 'text-emerald-700' : 'text-red-600'}`} dir="ltr">
                      {amt > 0 ? '+' : ''}{fmtMoney(amt)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5 whitespace-pre-line">
                      {(tx.type === 'approved_task_payment' || tx.type === 'lawyer_expense_wallet_deduction') && tx.notes
                        ? tx.notes
                        : walletTransactionLabel(tx.type as WalletTransactionType, wallet)}
                    </p>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono shrink-0" dir="ltr">{fmtDate(tx.created_at)}</span>
                </div>
              )
            })}
          </div>
          <ShowMoreFooter hasMore={hasMore} expanded={expanded} onToggle={toggle} total={total} />
        </>
      )}
    </div>
  )
}
