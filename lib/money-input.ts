/** Strip non-digits and parse as number (empty → 0). */
export function parseMoneyInput(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const digits = value.replace(/[^\d]/g, '')
  if (!digits) return 0
  return Number(digits)
}

/** Keep digits only and add thousands separators for display. */
export function formatMoneyInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const digits = String(value).replace(/[^\d]/g, '')
  if (!digits) return ''
  return Number(digits).toLocaleString('en-US')
}
