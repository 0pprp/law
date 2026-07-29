/**
 * تحويل قيمة `file_path` المخزّنة إلى رابط عام مطلق على R2.
 * آمن للاستيراد من Client و Server.
 *
 * الحالات المدعومة:
 * - رابط Supabase Storage قديم → يُستخرج المسار ويُبنى رابط R2.
 * - رابط R2 كامل → يُستخدم كما هو (أو يُطبَّع على القاعدة الحالية).
 * - مسار نسبي (`{debtorId}/{uuid}.pdf`) → يُبنى مفتاح R2 مع بادئة الباكت.
 * - مسار نسبي يبدأ ببادئة الباكت أصلاً → لا تُضاف البادئة مرتين.
 */
import { getR2PublicBase, getR2Url, type R2LegacyBucket } from '@/lib/r2-url'

/** يُستخدم فقط إذا لم تُضبط NEXT_PUBLIC_R2_PUBLIC_URL — يمنع الروابط النسبية (404) */
const R2_PUBLIC_URL_FALLBACK = 'https://pub-029fa309232c423fbacd7723c644d28f.r2.dev'

const LEGACY_BUCKETS = new Set<R2LegacyBucket>(['task-files', 'debtor-files', 'lawyer-files'])

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function r2PublicBase(): string {
  return getR2PublicBase() || R2_PUBLIC_URL_FALLBACK
}

/** هل القيمة رابط تخزين Supabase قديم؟ */
function isSupabaseStorageUrl(value: string): boolean {
  return /\/storage\/v1\/object\/(?:public|sign|authenticated)\//i.test(value)
}

/**
 * يستخرج مفتاح الكائن داخل باكت R2 الموحّد: `{bucket}/{relativePath}`
 * من مسار نسبي أو رابط مطلق (Supabase / R2).
 */
export function resolveR2ObjectKey(
  bucket: R2LegacyBucket,
  storedPath: string | null | undefined,
): string | null {
  const raw = String(storedPath ?? '').trim()
  if (!raw) return null

  if (isAbsoluteUrl(raw)) {
    // .../storage/v1/object/public|sign|authenticated/{bucket}/{path}
    const supabase = raw.match(
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/(task-files|debtor-files|lawyer-files)\/([^?#]+)/i,
    )
    if (supabase) {
      const b = supabase[1].toLowerCase() as R2LegacyBucket
      const rel = decodeURIComponent(supabase[2]).replace(/^\/+/, '')
      if (!rel || rel.includes('..')) return null
      return `${b}/${rel}`
    }

    // رابط R2 عام: https://pub-xxx.r2.dev/{bucket}/... أو أي قاعدة مضبوطة
    try {
      const u = new URL(raw)
      const path = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
      if (!path || path.includes('..')) return null
      const first = path.split('/')[0]
      if (LEGACY_BUCKETS.has(first as R2LegacyBucket)) return path
      // مسار بدون بادئة الباكت داخل نفس الـ host العام
      return `${bucket}/${path}`
    } catch {
      return null
    }
  }

  const clean = raw.replace(/^\/+/, '')
  if (!clean || clean.includes('..') || clean.includes('\\') || clean.includes('\0')) return null
  if (clean.startsWith(`${bucket}/`)) return clean
  const first = clean.split('/')[0]
  if (LEGACY_BUCKETS.has(first as R2LegacyBucket)) return clean
  return `${bucket}/${clean}`
}

/** مسار نسبي داخل الباكت (بدون بادئة `debtor-files/` إلخ) — للحذف والتحقق */
export function relativeStoredPath(
  bucket: R2LegacyBucket,
  storedPath: string | null | undefined,
): string | null {
  const key = resolveR2ObjectKey(bucket, storedPath)
  if (!key) return null
  const prefix = `${bucket}/`
  return key.startsWith(prefix) ? key.slice(prefix.length) : key
}

/** هل يمكن تحويل القيمة المخزّنة إلى رابط R2 صالح؟ */
export function canResolveStoredFilePath(
  bucket: R2LegacyBucket,
  storedPath: string | null | undefined,
): boolean {
  return Boolean(resolveR2ObjectKey(bucket, storedPath))
}

export function storedFileUrl(bucket: R2LegacyBucket, storedPath: string | null | undefined): string {
  const raw = String(storedPath ?? '').trim()
  if (!raw) return ''

  // رابط R2 كامل غير قادم من Supabase — أعده كما هو إن أمكن
  if (isAbsoluteUrl(raw) && !isSupabaseStorageUrl(raw)) {
    const base = r2PublicBase()
    if (raw.startsWith(`${base}/`) || /\.r2\.dev\//i.test(raw)) return raw
  }

  const key = resolveR2ObjectKey(bucket, raw)
  if (!key) return ''

  const url = getR2Url(key)
  if (isAbsoluteUrl(url)) return url

  return `${r2PublicBase().replace(/\/$/, '')}/${url.replace(/^\/+/, '')}`
}
