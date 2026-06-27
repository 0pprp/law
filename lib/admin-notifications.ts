export interface ExpenseTypePendingCount {
  type: string
  count: number
}

export interface AdminNotificationCounts {
  pendingReview: number
  pendingPayoutRequests: number
  pendingTaskFeeReceipts: number
  pendingExpenses: number
  pendingExpensesByType: ExpenseTypePendingCount[]
}

export const ADMIN_NOTIFICATIONS_REFRESH = 'admin-notifications-refresh'

export function refreshAdminNotifications() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ADMIN_NOTIFICATIONS_REFRESH))
  }
}

export function totalAdminNotifications(counts: AdminNotificationCounts): number {
  return (
    counts.pendingReview
    + counts.pendingPayoutRequests
    + counts.pendingTaskFeeReceipts
    + counts.pendingExpenses
  )
}

export function pendingFinanceRequests(counts: AdminNotificationCounts): number {
  return counts.pendingPayoutRequests + counts.pendingTaskFeeReceipts
}

export async function fetchAdminNotificationCounts(): Promise<AdminNotificationCounts> {
  const empty: AdminNotificationCounts = {
    pendingReview: 0,
    pendingPayoutRequests: 0,
    pendingTaskFeeReceipts: 0,
    pendingExpenses: 0,
    pendingExpensesByType: [],
  }
  const res = await fetch('/api/admin/notification-counts', { cache: 'no-store' })
  if (!res.ok) return empty
  return { ...empty, ...await res.json() }
}
