import { formatMoney as formatMoneyValue } from './money-input'

export { formatMoney, formatMoneyInput, parseMoneyInput } from './money-input'

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US')
}

export function fmtMoney(n: number | null | undefined): string {
  return formatMoneyValue(n)
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return d.split('T')[0]
}

export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d)
  return date.toLocaleDateString('en-CA') + ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}
