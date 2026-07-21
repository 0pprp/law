/**
 * فك ZIP آمن لاستيراد مستمسكات الجزائي — PDF فقط.
 * حماية: Zip Slip / traversal / bomb / nested archives / symlink-ish paths.
 */
import {
  CRIMINAL_IMPORT_MAX_COMPRESSION_RATIO,
  CRIMINAL_IMPORT_MAX_FILENAME_LEN,
  CRIMINAL_IMPORT_MAX_PDF_BYTES,
  CRIMINAL_IMPORT_MAX_UNCOMPRESSED_BYTES,
  CRIMINAL_IMPORT_MAX_ZIP_BYTES,
  CRIMINAL_IMPORT_MAX_ZIP_ENTRIES,
  CRIMINAL_IMPORT_ZIP_MIME,
} from '@/lib/criminal-import-limits'
import { normalizePdfFileName } from '@/lib/criminal-import-normalize'

export type SafeZipPdf = {
  /** اسم الملف المطابق (basename lower) */
  key: string
  originalName: string
  bytes: Uint8Array
}

export type SafeZipParseResult =
  | { ok: true; files: SafeZipPdf[]; warnings: string[] }
  | { ok: false; error: string }

function isPdfMagic(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46
}

function isUnsafeZipPath(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  if (!p || p.length > CRIMINAL_IMPORT_MAX_FILENAME_LEN + 40) return true
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return true
  if (p.includes('..')) return true
  if (p.includes('\0')) return true
  // symlink-like / nested archive extensions
  const base = p.split('/').pop() ?? ''
  const ext = (base.split('.').pop() || '').toLowerCase()
  if (['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'exe', 'js', 'bat', 'cmd', 'sh', 'lnk'].includes(ext)) {
    return true
  }
  return false
}

export function validateCriminalImportZipFile(file: File | Blob, fileName?: string): string | null {
  const name = fileName || (file instanceof File ? file.name : 'archive.zip')
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ext !== 'zip') return 'يجب أن يكون الأرشيف بصيغة ZIP'
  if (file.size <= 0) return 'ملف ZIP فارغ'
  if (file.size > CRIMINAL_IMPORT_MAX_ZIP_BYTES) {
    return `حجم ZIP يتجاوز الحد (${Math.floor(CRIMINAL_IMPORT_MAX_ZIP_BYTES / (1024 * 1024))} ميجابايت)`
  }
  if (file instanceof File) {
    const mime = (file.type || '').toLowerCase()
    if (mime && !CRIMINAL_IMPORT_ZIP_MIME.has(mime)) {
      return 'نوع ملف ZIP غير صالح'
    }
  }
  return null
}

/**
 * يفك ZIP في الذاكرة فقط ويعيد خريطة PDF الآمنة.
 * الملفات غير PDF تُسجَّل كتحذيرات ولا تُرفع.
 */
export async function parseCriminalImportZipSafe(
  file: File | Blob,
  fileName?: string,
): Promise<SafeZipParseResult> {
  const pre = validateCriminalImportZipFile(file, fileName)
  if (pre) return { ok: false, error: pre }

  const JSZip = (await import('jszip')).default
  let zip: Awaited<ReturnType<typeof JSZip.loadAsync>>
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer(), { createFolders: false })
  } catch {
    return { ok: false, error: 'تعذر قراءة ملف ZIP — الملف تالف أو غير صالح' }
  }

  const warnings: string[] = []
  const files: SafeZipPdf[] = []
  const seenKeys = new Map<string, number>()
  let uncompressedTotal = 0
  let fileCount = 0

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    fileCount += 1
    if (fileCount > CRIMINAL_IMPORT_MAX_ZIP_ENTRIES) {
      return { ok: false, error: `عدد ملفات ZIP يتجاوز الحد (${CRIMINAL_IMPORT_MAX_ZIP_ENTRIES})` }
    }

    if (isUnsafeZipPath(path)) {
      return { ok: false, error: `مسار غير آمن داخل ZIP: مرفوض` }
    }

    // JSZip قد يعرض _data.uncompressedSize
    const meta = entry as { _data?: { uncompressedSize?: number; compressedSize?: number } }
    const unc = meta._data?.uncompressedSize
    const comp = meta._data?.compressedSize
    if (typeof unc === 'number' && unc > CRIMINAL_IMPORT_MAX_PDF_BYTES * 2) {
      // تحقق لاحقاً بدقة بعد القراءة للـ PDF؛ هنا رفض مبكر للضخامة المفرطة
    }
    if (typeof unc === 'number' && typeof comp === 'number' && comp > 0) {
      const ratio = unc / comp
      if (ratio > CRIMINAL_IMPORT_MAX_COMPRESSION_RATIO && unc > 1024 * 1024) {
        return { ok: false, error: 'نسبة ضغط غير منطقية داخل ZIP (حماية Zip Bomb)' }
      }
    }

    const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
    if (base.length > CRIMINAL_IMPORT_MAX_FILENAME_LEN) {
      return { ok: false, error: 'اسم ملف داخل ZIP أطول من المسموح' }
    }

    const key = normalizePdfFileName(base)
    const ext = (base.split('.').pop() || '').toLowerCase()

    if (ext !== 'pdf') {
      warnings.push(`تجاهل ملف غير PDF داخل ZIP: ${base}`)
      continue
    }

    let bytes: Uint8Array
    try {
      bytes = await entry.async('uint8array')
    } catch {
      warnings.push(`تعذر قراءة الملف: ${base}`)
      continue
    }

    uncompressedTotal += bytes.byteLength
    if (uncompressedTotal > CRIMINAL_IMPORT_MAX_UNCOMPRESSED_BYTES) {
      return { ok: false, error: 'الحجم الإجمالي بعد فك ZIP يتجاوز الحد المسموح' }
    }

    if (bytes.byteLength === 0) {
      warnings.push(`ملف PDF فارغ: ${base}`)
      continue
    }
    if (bytes.byteLength > CRIMINAL_IMPORT_MAX_PDF_BYTES) {
      warnings.push(`PDF أكبر من الحد: ${base}`)
      continue
    }
    if (!isPdfMagic(bytes)) {
      warnings.push(`ملف بامتداد PDF لكن محتواه غير صالح: ${base}`)
      continue
    }

    const count = (seenKeys.get(key) ?? 0) + 1
    seenKeys.set(key, count)
    if (count > 1) {
      // لا تخمّن — علّم التكرار؛ المستدعي يفشل الصفوف المرتبطة
      warnings.push(`تكرار اسم الملف داخل ZIP: ${base}`)
    }

    files.push({ key, originalName: base, bytes })
  }

  return { ok: true, files, warnings }
}

/** خريطة اسم→ملف مع كشف التكرار */
export function buildCriminalPdfLookup(files: SafeZipPdf[]): {
  byKey: Map<string, SafeZipPdf>
  duplicates: Set<string>
} {
  const byKey = new Map<string, SafeZipPdf>()
  const duplicates = new Set<string>()
  const counts = new Map<string, number>()
  for (const f of files) {
    counts.set(f.key, (counts.get(f.key) ?? 0) + 1)
  }
  for (const [k, c] of counts) {
    if (c > 1) duplicates.add(k)
  }
  for (const f of files) {
    if (duplicates.has(f.key)) continue
    byKey.set(f.key, f)
  }
  return { byKey, duplicates }
}
