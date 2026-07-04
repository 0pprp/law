/** Strip non-digits and parse as number (empty → 0). */
export function parseMoneyInput(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const digits = value.replace(/[^\d]/g, '')
  if (!digits) return 0
  return Number(digits)
}

/** Keep digits only and add thousands separators for display while typing. */
export function formatMoneyInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const digits = String(value).replace(/[^\d]/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('en-US')
}

/** Display monetary amount with thousands separators (default: with د.ع suffix). */
export function formatMoney(
  value: number | null | undefined,
  options?: { suffix?: boolean },
): string {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const formatted = Number(value).toLocaleString('en-US')
  if (options?.suffix === false) return formatted
  return `${formatted} د.ع`
}
