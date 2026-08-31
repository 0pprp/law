/** رقم المعاملة وتاريخ البيع على جدول المدينين. */

export function normalizeTransactionNumber(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  return s ? s.slice(0, 80) : null
}

/** تاريخ YYYY-MM-DD اختياري. false = قيمة غير صالحة. */
export function parseOptionalYmdDate(raw: unknown): string | null | false {
  if (raw == null || raw === '') return null
  const s = String(raw).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false
  return s
}

export function isMissingTxnSaleColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  const msg = (error.message ?? '').toLowerCase()
  return (
    msg.includes('transaction_number')
    || msg.includes('sale_date')
    || error.code === '42703'
    || error.code === 'PGRST204'
  )
}
