/** مسار رجوع آمن داخل لوحة الإدارة فقط — يمنع التحويل الخارجي. */
export function safeAdminReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  let path = raw.trim()
  if (!path) return null
  try {
    path = decodeURIComponent(path)
  } catch {
    // already decoded
  }
  if (!path.startsWith('/admin/')) return null
  if (path.startsWith('//') || path.includes('://') || path.includes('\\')) return null
  if (path.includes('\n') || path.includes('\r')) return null
  return path
}

export function withReturnTo(href: string, returnTo: string): string {
  const sep = href.includes('?') ? '&' : '?'
  return `${href}${sep}returnTo=${encodeURIComponent(returnTo)}`
}
