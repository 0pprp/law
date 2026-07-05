/** توحيد اسم المهمة للمقارنة — يتجاهل «ال» والهمزات واختلافات الكتابة */
export function normalizeTaskLabelKey(label: string): string {
  return label
    .trim()
    .replace(/\u0640/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+ال(?=[\u0621-\u064A])/g, ' ')
    .replace(/^ال(?=[\u0621-\u064A])/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

export function labelsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a?.trim() || !b?.trim()) return false
  return normalizeTaskLabelKey(a) === normalizeTaskLabelKey(b)
}
