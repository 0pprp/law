import { formatErrorMessage } from '@/lib/format-error'

/** رسالة خطأ من استجابة API — تتجنب عرض 0 أو قيم غير مفهومة */
export function readApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const err = (data as { error?: unknown }).error
  if (typeof err === 'string' && err.trim()) return err
  if (typeof err === 'number') return fallback
  if (err != null) {
    const formatted = formatErrorMessage(err)
    if (formatted && formatted !== '0') return formatted
  }
  return fallback
}
