/**
 * حدود أمان استيراد الجزائي (Excel + ZIP + PDF).
 * وثّقت هنا لتكون مرجعاً واحداً للاختبارات والـ API.
 */

/** أقصى حجم لملف Excel */
export const CRIMINAL_IMPORT_MAX_EXCEL_BYTES = 8 * 1024 * 1024 // 8 MB

/** أقصى حجم لملف ZIP */
export const CRIMINAL_IMPORT_MAX_ZIP_BYTES = 40 * 1024 * 1024 // 40 MB

/** أقصى عدد ملفات داخل ZIP */
export const CRIMINAL_IMPORT_MAX_ZIP_ENTRIES = 500

/** أقصى حجم إجمالي بعد الفك */
export const CRIMINAL_IMPORT_MAX_UNCOMPRESSED_BYTES = 80 * 1024 * 1024 // 80 MB

/** أقصى حجم PDF منفرد (متوافق مع رفع الجزائي) */
export const CRIMINAL_IMPORT_MAX_PDF_BYTES = 15 * 1024 * 1024 // 15 MB

/** أقصى طول لاسم ملف داخل ZIP */
export const CRIMINAL_IMPORT_MAX_FILENAME_LEN = 180

/** أقصى نسبة ضغط (uncompressed / compressed) — حماية Zip Bomb */
export const CRIMINAL_IMPORT_MAX_COMPRESSION_RATIO = 100

/** أقصى عدد صفوف بيانات في Excel */
export const CRIMINAL_IMPORT_MAX_ROWS = 500

/** امتدادات Excel المقبولة */
export const CRIMINAL_IMPORT_EXCEL_EXTS = new Set(['xlsx', 'xls'])

/** MIME مقبولة لـ Excel (مرنة — التحقق النهائي بالقراءة) */
export const CRIMINAL_IMPORT_EXCEL_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream',
  '',
])

export const CRIMINAL_IMPORT_ZIP_MIME = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
  '',
])
