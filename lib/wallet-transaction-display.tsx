import type { WalletTransactionType, LawyerWalletKind } from '@/lib/types'
import { WALLET_TRANSACTION_LABELS } from '@/lib/types'

export function walletTransactionLabel(
  type: WalletTransactionType,
  wallet: LawyerWalletKind,
  amount?: number,
): string {
  if (type === 'task_expense_deduction') return WALLET_TRANSACTION_LABELS.task_expense_deduction
  if (type === 'savings_withdrawal') return WALLET_TRANSACTION_LABELS.savings_withdrawal
  if (wallet === 'savings' && (amount ?? 0) < 0) return WALLET_TRANSACTION_LABELS.task_expense_deduction
  if (wallet === 'savings' && (type === 'accountant_transfer' || type === 'transfer_from_savings')) {
    return WALLET_TRANSACTION_LABELS.accountant_transfer
  }
  return WALLET_TRANSACTION_LABELS[type] ?? type
}

export type WalletTxIconKind = 'credit' | 'debit' | 'task' | 'savings' | 'payout' | 'adjust'

export function walletTransactionIconKind(
  type: WalletTransactionType,
  wallet: LawyerWalletKind,
  amount: number,
): WalletTxIconKind {
  if (wallet === 'savings') return 'savings'
  if (type === 'approved_task_payment') return 'task'
  if (type === 'fee_payout') return 'payout'
  if (type === 'manual_adjustment') return 'adjust'
  return amount > 0 ? 'credit' : 'debit'
}

export function WalletTransactionIcon({
  kind,
  className = 'w-5 h-5',
}: {
  kind: WalletTxIconKind
  className?: string
}) {
  switch (kind) {
    case 'task':
      return (
        <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    case 'savings':
      return (
        <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    case 'payout':
      return (
        <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      )
    case 'adjust':
      return (
        <svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      )
    case 'credit':
      return (
        <svg className={className} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      )
    default:
      return (
        <svg className={className} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
        </svg>
      )
  }
}

export function walletIconColors(kind: WalletTxIconKind, amount: number, wallet?: LawyerWalletKind): string {
  if (wallet === 'savings' || kind === 'savings') return amount >= 0 ? 'bg-sky-50 text-sky-600' : 'bg-orange-50 text-orange-600'
  if (kind === 'task') return 'bg-emerald-50 text-emerald-600'
  if (kind === 'payout') return 'bg-red-50 text-red-600'
  if (kind === 'adjust') return 'bg-slate-100 text-slate-600'
  return amount > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
}
