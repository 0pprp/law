/** استخراج ومزامنة تاريخ الجلسة/المرافعة من completion_data */

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

const HEARING_KEY_RE = /(hearing|جلسة|مرافعة)/i

export function normalizeHearingYmd(value: unknown): string | null {
  if (value == null) return null
  const s = String(value).trim().slice(0, 10)
  return YMD_RE.test(s) ? s : null
}

/** هل هذا المفتاح يمثل تاريخ جلسة/مرافعة؟ */
export function isHearingDateFieldKey(key: string): boolean {
  if (key === 'hearing_date') return true
  if (HEARING_KEY_RE.test(key)) return true
  return false
}

/**
 * يستخرج تاريخ المرافعة من بيانات الإنجاز.
 * يدعم hearing_date ومفاتيح مشابهة، وأيضاً حقول date المسمّاة جلسة/مرافعة في القيمة المعروضة عبر المفتاح.
 */
export function extractHearingDateFromCompletion(
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data || typeof data !== 'object') return null

  const direct = normalizeHearingYmd(data.hearing_date)
  if (direct) return direct

  for (const [key, raw] of Object.entries(data)) {
    if (!isHearingDateFieldKey(key)) continue
    const ymd = normalizeHearingYmd(raw)
    if (ymd) return ymd
  }

  // حقول date مفهرسة: field_N_date — إن وُجد تاريخ واحد فقط في مهمة إقامة دعوى غالباً هو الجلسة
  const dateEntries = Object.entries(data)
    .filter(([key]) => key === 'date' || /(^|_)date$/i.test(key) || key.includes('_date'))
    .map(([key, raw]) => ({ key, ymd: normalizeHearingYmd(raw) }))
    .filter((e): e is { key: string; ymd: string } => Boolean(e.ymd))

  if (dateEntries.length === 1) return dateEntries[0].ymd

  // عدة تواريخ: فضّل مفتاحاً يحتوي hearing/جلسة
  const preferred = dateEntries.find(e => isHearingDateFieldKey(e.key))
  if (preferred) return preferred.ymd

  return null
}
