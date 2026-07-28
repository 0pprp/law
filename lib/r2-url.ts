/**
 * روابط R2 العامة — آمنة للاستيراد من Client و Server.
 * مفاتيح الكائنات داخل الباكت الموحّد: `{supabaseBucket}/{relativePath}`
 * مثال: task-files/abc/file.pdf
 */
export type R2LegacyBucket = 'task-files' | 'debtor-files' | 'lawyer-files'

export function getR2PublicBase(): string {
  const base =
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL
    || process.env.R2_PUBLIC_URL
    || ''
  return base.replace(/\/$/, '')
}

/** يبني مفتاح R2 مع بادئة اسم باكت Supabase السابق لتفادي التعارض */
export function r2ObjectKey(bucket: R2LegacyBucket, path: string): string {
  const clean = String(path ?? '').replace(/^\/+/, '')
  return `${bucket}/${clean}`
}

/** رابط عام للملف من مفتاح R2 الكامل */
export function getR2Url(key: string): string {
  const base = getR2PublicBase()
  const clean = String(key ?? '').replace(/^\/+/, '')
  if (!base) {
    // بدون إعداد — أعد المسار النسبي حتى لا ينكسر البناء
    return clean
  }
  return `${base}/${clean}`
}

export function getR2UrlFor(bucket: R2LegacyBucket, path: string): string {
  return getR2Url(r2ObjectKey(bucket, path))
}
