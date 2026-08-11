export interface ExpenseTypePendingCount {
  type: string
  count: number
}

export interface AdminNotificationCounts {
  pendingReview: number
  /** طلبات «إرسال بدون إنجاز» بانتظار المراجعة */
  pendingIncomplete: number
  pendingPayoutRequests: number
  pendingTaskFeeReceipts: number
  pendingExpenses: number
  pendingExpensesByType: ExpenseTypePendingCount[]
}

export const ADMIN_NOTIFICATIONS_REFRESH = 'admin-notifications-refresh'

export function refreshAdminNotifications() {
  cachedCounts = null
  cachedAt = 0
  cachedFreshUntil = 0
  cachedBranchKey = null
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ADMIN_NOTIFICATIONS_REFRESH))
  }
}

export function totalAdminNotifications(counts: AdminNotificationCounts): number {
  return (
    counts.pendingReview
    + (counts.pendingIncomplete ?? 0)
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
  pendingIncomplete: 0,
  pendingPayoutRequests: 0,
  pendingTaskFeeReceipts: 0,
  pendingExpenses: 0,
  pendingExpensesByType: [],
}

let cachedCounts: AdminNotificationCounts | null = null
let cachedAt = 0
let cachedFreshUntil = 0
let cachedBranchKey: string | null = null
let inflight: Promise<AdminNotificationCounts> | null = null
const CLIENT_TTL_MS = 45_000
const STALE_MS = 5 * 60_000

/** قراءة فورية من الذاكرة (للرسم الأول بدون انتظار شبكة) */
export function peekAdminNotificationCounts(
  branchKey: string | null = null,
): AdminNotificationCounts | null {
  const key = branchKey ?? '__none__'
  if (!cachedCounts || cachedBranchKey !== key) return null
  if (Date.now() > cachedAt + STALE_MS) return null
  return cachedCounts
}

export async function fetchAdminNotificationCounts(
  force = false,
  branchKey: string | null = null,
): Promise<AdminNotificationCounts> {
  const key = branchKey ?? '__none__'
  const now = Date.now()

  if (
    !force
    && cachedCounts
    && cachedBranchKey === key
    && now < cachedFreshUntil
  ) {
    return cachedCounts
  }

  // stale-while-revalidate: أعد القديميم فوراً وحدّث بالخلفية
  const hasStale =
    !force
    && cachedCounts
    && cachedBranchKey === key
    && now < cachedAt + STALE_MS

  if (inflight && cachedBranchKey === key) {
    if (hasStale && cachedCounts) return cachedCounts
    return inflight
  }

  cachedBranchKey = key
  const fetchPromise = (async () => {
    try {
      const res = await fetch('/api/admin/notification-counts', {
        // احترم Cache-Control الخاص بالـ API بدل no-store دائماً
        credentials: 'same-origin',
      })
      if (!res.ok) return cachedCounts ?? EMPTY_COUNTS
      const next = { ...EMPTY_COUNTS, ...await res.json() } as AdminNotificationCounts
      cachedCounts = next
      cachedAt = Date.now()
      cachedFreshUntil = cachedAt + CLIENT_TTL_MS
      return next
    } catch {
      return cachedCounts ?? EMPTY_COUNTS
    } finally {
      inflight = null
    }
  })()

  inflight = fetchPromise

  if (hasStale && cachedCounts) {
    void fetchPromise
    return cachedCounts
  }

  return fetchPromise
}
