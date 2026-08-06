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
  if (key === 'hearing_date' || key === 'date') return true
  if (HEARING_KEY_RE.test(key)) return true
  if (/^field_\d+_date$/i.test(key)) return true
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

/** كل مفاتيح تاريخ المرافعة الموجودة في بيانات الإنجاز */
export function listHearingDateFieldKeys(
  data: Record<string, unknown> | null | undefined,
): string[] {
  if (!data || typeof data !== 'object') return []
  return Object.keys(data).filter(key => {
    if (!isHearingDateFieldKey(key)) return false
    return data[key] != null && String(data[key]).trim() !== ''
  })
}

/**
 * يوحّد كل مفاتيح تاريخ المرافعة على قيمة واحدة (يمنع ظهور تاريخين مختلفين).
 * يُبقي hearing_date دائماً كنسخة معيارية.
 */
export function syncHearingDateInCompletion(
  data: Record<string, unknown>,
  ymd: string,
  extraKeys: string[] = [],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data }
  const keys = new Set<string>(['hearing_date', 'date', ...extraKeys, ...listHearingDateFieldKeys(data)])
  for (const key of keys) {
    next[key] = ymd
  }
  return next
}

/** مفتاح واحد للعرض/التعديل — يفضّل hearing_date ثم date */
export function pickCanonicalHearingFieldKey(keys: Iterable<string>): string {
  const list = [...keys]
  if (list.includes('hearing_date')) return 'hearing_date'
  if (list.includes('date')) return 'date'
  return list[0] ?? 'hearing_date'
}
