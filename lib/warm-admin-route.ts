'use client'

import { fetchAdminNotificationCounts } from '@/lib/admin-notifications'

const warmed = new Set<string>()
let lastWarmAt = 0

/**
 * تسخين خفيف عند مرور المؤشر على روابط القائمة —
 * يجعل الانتقال التالي يرسم من الكاش فوراً.
 */
export function warmAdminRoute(href: string, branchId: string | null): void {
  if (typeof window === 'undefined') return
  const now = Date.now()
  // لا نُغرق الشبكة: مرة كل 2 ثانية كحد أقصى لنفس المسار+الفرع
  const key = `${href}|${branchId ?? 'none'}`
  if (warmed.has(key) && now - lastWarmAt < 2000) return
  warmed.add(key)
  lastWarmAt = now

  if (branchId) {
    void fetchAdminNotificationCounts(false, branchId)
  }

  // امسح المفاتيح القديمة حتى لا تنمو المجموعة بلا حدود
  if (warmed.size > 40) warmed.clear()
}
