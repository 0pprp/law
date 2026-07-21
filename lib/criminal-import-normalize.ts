/**
 * تطبيع نصوص/تواريخ/مبالغ استيراد الجزائي — للمطابقة والتحقق فقط.
 * القيمة المخزّنة للاسم تُنظَّف تنظيفاً خفيفاً دون فقدان المعنى.
 */
import { CONTRACT_GUARANTOR_IMPORT_MAP } from '@/lib/criminal-import-columns'
import type { ContractGuarantorStatus } from '@/lib/criminal-debtor-details'

const EASTERN_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}

const INVISIBLE = /[\u200B-\u200D\uFEFF\u00A0]/g
const TATWEEL = /\u0640/g
const DIACRITICS = /[\u064B-\u065F\u0670]/g

/** حد مبلغ منطقي لـ numeric/bigint في المشروع */
export const CRIMINAL_IMPORT_MAX_AMOUNT = 999_999_999_999

export function unifyEasternDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, ch => EASTERN_DIGITS[ch] ?? ch)
}

export function collapseSpaces(s: string): string {
  return s.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim()
}

/** تنظيف خفيف للتخزين (اسم المدين المعروض) */
export function sanitizeDisplayText(raw: unknown): string {
  return collapseSpaces(String(raw ?? '').replace(INVISIBLE, ' '))
}

/** مفتاح مطابقة — ألف/همزات/أرقام/مسافات */
export function normalizeForMatch(raw: unknown): string {
  let s = collapseSpaces(String(raw ?? ''))
  if (!s) return ''
  s = s.replace(TATWEEL, '')
  s = s.replace(DIACRITICS, '')
  s = s.replace(/[أإآٱ]/g, 'ا').replace(/\u0671/g, 'ا')
  s = s.replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  s = unifyEasternDigits(s)
  s = s.replace(/['"«»„‟]/g, '')
  return collapseSpaces(s).toLowerCase()
}

/** تطبيع رأس العمود للمرادفات */
export function normalizeHeaderLabel(raw: unknown): string {
  return normalizeForMatch(raw)
}

/** اسم ملف للمطابقة: basename + lower + بدون مسافات زائدة */
export function normalizePdfFileName(raw: unknown): string {
  let s = collapseSpaces(String(raw ?? ''))
  s = s.replace(/\\/g, '/').split('/').pop() ?? ''
  s = s.replace(INVISIBLE, '')
  s = unifyEasternDigits(s)
  return s.trim().toLowerCase()
}

export function cellToString(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number' && Number.isFinite(v)) {
    // تجنّب 1e21 وغيرها — للأرقام الصحيحة الكبيرة كسلسلة
    if (Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER) return String(v)
    return String(v)
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getUTCFullYear()
    const m = String(v.getUTCMonth() + 1).padStart(2, '0')
    const d = String(v.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return collapseSpaces(String(v))
}

/**
 * تحويل تاريخ واقعة → YYYY-MM-DD أو null (فارغ) أو خطأ.
 * بدون اعتماد على Locale الجهاز؛ بدون انزياح timezone.
 */
export function parseCriminalIncidentDate(
  raw: unknown,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null }

  // Excel serial (SheetJS قد يعيد رقماً)
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return excelSerialToYmd(raw)
  }

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear()
    const m = String(raw.getMonth() + 1).padStart(2, '0')
    const d = String(raw.getDate()).padStart(2, '0')
    const ymd = `${y}-${m}-${d}`
    return isValidYmd(ymd) ? { ok: true, value: ymd } : { ok: false, error: 'تاريخ الواقعة غير صالح' }
  }

  const s = unifyEasternDigits(collapseSpaces(String(raw)))
  if (!s) return { ok: true, value: null }

  // رقم تسلسلي كنص
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s)
    if (n > 20000 && n < 80000) return excelSerialToYmd(n)
  }

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) {
    const ymd = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    return isValidYmd(ymd) ? { ok: true, value: ymd } : { ok: false, error: 'تاريخ الواقعة غير صالح' }
  }

  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/)
  if (m) {
    const ymd = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return isValidYmd(ymd) ? { ok: true, value: ymd } : { ok: false, error: 'تاريخ الواقعة غير صالح' }
  }

  return { ok: false, error: 'تاريخ الواقعة غير صالح' }
}

function excelSerialToYmd(serial: number): { ok: true; value: string } | { ok: false; error: string } {
  if (!Number.isFinite(serial) || serial < 1) {
    return { ok: false, error: 'تاريخ الواقعة غير صالح' }
  }
  // Excel epoch 1899-12-30 UTC — استخدم UTC لتجنّب انزياح اليوم
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const ymd = `${y}-${mo}-${day}`
  return isValidYmd(ymd) ? { ok: true, value: ymd } : { ok: false, error: 'تاريخ الواقعة غير صالح' }
}

export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false
  const [y, m, d] = ymd.split('-').map(Number)
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * مبلغ اختياري — يرفض النصوص الجزئية (100abc) والسالب.
 * فارغ → null ؛ صفر مسموح.
 */
export function parseCriminalImportAmount(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, value: null }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, error: 'المبلغ غير صالح' }
    if (raw < 0) return { ok: false, error: 'المبلغ لا يمكن أن يكون سالباً' }
    if (raw > CRIMINAL_IMPORT_MAX_AMOUNT) return { ok: false, error: 'المبلغ خارج الحدود المسموحة' }
    if (!Number.isInteger(raw) && !Number.isInteger(Math.round(raw))) {
      // اسمح بأرقام عشرية صحيحة فقط إن كانت .0
    }
    const n = Math.round(raw)
    if (Math.abs(raw - n) > 1e-9) return { ok: false, error: 'المبلغ يجب أن يكون رقماً صحيحاً' }
    return { ok: true, value: n }
  }

  let s = unifyEasternDigits(collapseSpaces(String(raw)))
  if (!s) return { ok: true, value: null }
  s = s.replace(/,/g, '').replace(/\s/g, '')
  if (!/^\d+$/.test(s)) {
    return { ok: false, error: 'المبلغ غير صالح — أدخل أرقاماً فقط' }
  }
  if (s.length > 15) return { ok: false, error: 'المبلغ خارج الحدود المسموحة' }
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'المبلغ غير صالح' }
  if (n > CRIMINAL_IMPORT_MAX_AMOUNT) return { ok: false, error: 'المبلغ خارج الحدود المسموحة' }
  return { ok: true, value: n }
}

export function parseContractGuarantorImport(
  raw: unknown,
): { ok: true; value: ContractGuarantorStatus | null } | { ok: false; error: string } {
  const display = collapseSpaces(unifyEasternDigits(String(raw ?? '')))
  if (!display) return { ok: true, value: null }
  const lower = display.toLowerCase()
  const mapped =
    CONTRACT_GUARANTOR_IMPORT_MAP[display]
    ?? CONTRACT_GUARANTOR_IMPORT_MAP[lower]
    ?? CONTRACT_GUARANTOR_IMPORT_MAP[normalizeForMatch(raw)]
  if (!mapped) {
    return { ok: false, error: 'قيمة العقد والكفيل غير صالحة — استخدم: نعم / لا / فقط عقد' }
  }
  return { ok: true, value: mapped }
}
