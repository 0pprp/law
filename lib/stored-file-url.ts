/**
 * تحويل قيمة `file_path` المخزّنة إلى رابط عام مطلق على R2.
 * آمن للاستيراد من Client و Server.
 *
 * الحالات المدعومة:
 * - رابط كامل (بقايا Supabase أو R2 بعد الترحيل) → يُستخدم كما هو.
 * - مسار نسبي (`{debtorId}/{uuid}.pdf`) → يُبنى مفتاح R2 مع بادئة الباكت.
 * - مسار نسبي يبدأ ببادئة الباكت أصلاً → لا تُضاف البادئة مرتين.
 */
import { getR2PublicBase, getR2Url, getR2UrlFor, type R2LegacyBucket } from '@/lib/r2-url'

/** يُستخدم فقط إذا لم تُضبط NEXT_PUBLIC_R2_PUBLIC_URL — يمنع الروابط النسبية (404) */
const R2_PUBLIC_URL_FALLBACK = 'https://pub-029fa309232c423fbacd7723c644d28f.r2.dev'

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export function storedFileUrl(bucket: R2LegacyBucket, storedPath: string | null | undefined): string {
  const raw = String(storedPath ?? '').trim()
  if (!raw) return ''
  if (isAbsoluteUrl(raw)) return raw

  const clean = raw.replace(/^\/+/, '')
  const url = clean.startsWith(`${bucket}/`) ? getR2Url(clean) : getR2UrlFor(bucket, clean)
  if (isAbsoluteUrl(url)) return url

  const base = getR2PublicBase() || R2_PUBLIC_URL_FALLBACK
  return `${base.replace(/\/$/, '')}/${url.replace(/^\/+/, '')}`
}
