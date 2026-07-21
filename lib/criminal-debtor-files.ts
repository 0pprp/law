/**
 * مسارات وملفات المدين الجزائي — bucket: debtor-files
 * documents → criminal/documents/{debtorId}/{uuid}.pdf
 * petition  → criminal/petitions/{debtorId}/{uuid}.pdf
 */
import { randomUUID } from 'node:crypto'
import { isPdfFile } from '@/lib/storage-path'

export const CRIMINAL_FILE_MAX_BYTES = 15 * 1024 * 1024
export type CriminalFileKind = 'documents' | 'petition'

export function criminalStorageFolder(kind: CriminalFileKind): string {
  return kind === 'petition' ? 'criminal/petitions' : 'criminal/documents'
}

export function buildCriminalFilePath(debtorId: string, kind: CriminalFileKind): string {
  const id = randomUUID()
  return `${criminalStorageFolder(kind)}/${debtorId}/${id}.pdf`
}

export function validateCriminalPdfUpload(file: File, buffer: Buffer): string | null {
  if (!file || file.size === 0) return 'ملف غير صالح'
  if (file.size > CRIMINAL_FILE_MAX_BYTES) return 'حجم الملف يتجاوز 15 ميجابايت'
  const mime = (file.type || '').toLowerCase()
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (mime !== 'application/pdf' || ext !== 'pdf') {
    return 'يجب أن يكون الملف بصيغة PDF فقط'
  }
  // رفض صريح لامتدادات شائعة
  const banned = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'docx', 'doc', 'zip', 'exe', 'rar'])
  if (banned.has(ext)) return 'صيغة الملف غير مسموحة — PDF فقط'
  if (!isPdfFile(file, buffer)) return 'يجب أن يكون الملف بصيغة PDF فقط'
  return null
}

export function isCriminalFileKind(v: unknown): v is CriminalFileKind {
  return v === 'documents' || v === 'petition'
}
