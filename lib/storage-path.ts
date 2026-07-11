/** رفض path traversal والأسماء الفارغة */
export function isSafeStoragePath(path: string | null | undefined): path is string {
  if (!path || typeof path !== 'string') return false
  const trimmed = path.trim()
  if (!trimmed || trimmed.length > 500) return false
  if (trimmed.includes('..') || trimmed.includes('\\') || trimmed.startsWith('/')) return false
  if (trimmed.includes('\0')) return false
  return true
}

/** مفتاح وصف آمن لمسار التخزين (أحرف وأرقام وشرطة فقط) */
export function sanitizeStorageKey(raw: string | null | undefined, maxLen = 40): string | null {
  if (!raw) return null
  const cleaned = raw
    .trim()
    .replace(/[^\w\u0600-\u06FF-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
  return cleaned || null
}

const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
])

const TASK_FILE_MIME = new Set([
  ...IMAGE_MIME,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const EXT_BY_MIME: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/jpg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
}

export function isAllowedTaskFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase()
  if (!TASK_FILE_MIME.has(mime)) return false
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const allowed = EXT_BY_MIME[mime]
  return !!allowed && allowed.includes(ext)
}

export function isPdfFile(file: File, buffer: Buffer): boolean {
  const mime = (file.type || '').toLowerCase()
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (mime !== 'application/pdf' || ext !== 'pdf') return false
  // %PDF
  return buffer.length >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46
}

export function pickAllowedFields(
  row: Record<string, unknown> | null | undefined,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!row || typeof row !== 'object') return out
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      out[key] = row[key]
    }
  }
  return out
}
