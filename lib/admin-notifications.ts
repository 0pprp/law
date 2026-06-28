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
  cachedCounts = null
  cachedAt = 0
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

const EMPTY_COUNTS: AdminNotificationCounts = {
  pendingReview: 0,
  pendingPayoutRequests: 0,
  pendingTaskFeeReceipts: 0,
  pendingExpenses: 0,
  pendingExpensesByType: [],
}

let cachedCounts: AdminNotificationCounts | null = null
let cachedAt = 0
let inflight: Promise<AdminNotificationCounts> | null = null
const CLIENT_TTL_MS = 45_000

export async function fetchAdminNotificationCounts(force = false): Promise<AdminNotificationCounts> {
  const now = Date.now()
  if (!force && cachedCounts && now - cachedAt < CLIENT_TTL_MS) {
    return cachedCounts
  }
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const res = await fetch('/api/admin/notification-counts', { cache: 'no-store' })
      if (!res.ok) return cachedCounts ?? EMPTY_COUNTS
      const next = { ...EMPTY_COUNTS, ...await res.json() } as AdminNotificationCounts
      cachedCounts = next
      cachedAt = Date.now()
      return next
    } catch {
      return cachedCounts ?? EMPTY_COUNTS
    } finally {
      inflight = null
    }
  })()

  return inflight
}
