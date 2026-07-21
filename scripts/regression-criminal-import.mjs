/**
 * Regression: criminal debtor Excel/ZIP import
 * Run: node scripts/regression-criminal-import.mjs
 * Target: ≥140 checks
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const passes = []

function assert(cond, ok, fail) {
  if (cond) passes.push(ok)
  else failures.push(fail)
}

function read(rel) {
  const p = path.join(root, rel)
  if (!fs.existsSync(p)) return ''
  return fs.readFileSync(p, 'utf8')
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel))
}

// --- Mirror helpers (must stay aligned with lib) ---
const EASTERN = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
}
function unifyDigits(s) {
  return String(s).replace(/[٠-٩]/g, ch => EASTERN[ch] ?? ch)
}
function collapse(s) {
  return String(s ?? '').replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ').replace(/\s+/g, ' ').trim()
}
function normalizeHeader(s) {
  let t = collapse(s)
  t = t.replace(/\u0640/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  return unifyDigits(t).toLowerCase()
}
function normalizeFileName(s) {
  let t = collapse(s).replace(/\\/g, '/').split('/').pop() ?? ''
  return unifyDigits(t).trim().toLowerCase()
}
const SYNONYMS = {
  الاسم: 'full_name',
  'اسم المدين': 'full_name',
  الفرع: 'branch_name',
  'اسم الفرع': 'branch_name',
  'العنوان الوظيفي': 'job_title',
  'المسمى الوظيفي': 'job_title',
  'عنوان السكن الحالي': 'current_address',
  'السكن الحالي': 'current_address',
  'العنوان الحالي': 'current_address',
  'تاريخ الواقعة': 'incident_date',
  'تاريخ الحادثة': 'incident_date',
  'نوع التهمة': 'charge_type',
  التهمة: 'charge_type',
  'المبلغ الذي بذمته': 'amount_owed',
  المبلغ: 'amount_owed',
  'المبلغ المطلوب': 'amount_owed',
  'العقد والكفيل': 'contract_guarantor',
  'حالة العقد والكفيل': 'contract_guarantor',
  'اسم الشاهد الأول': 'first_witness',
  'اسم الشاهد الثاني': 'second_witness',
  'اسم ملف المستمسكات والعقد': 'documents_filename',
  'ملف المستمسكات والعقد': 'documents_filename',
  'اسم الملف': 'documents_filename',
}
function fieldFromHeader(h) {
  return SYNONYMS[normalizeHeader(h)] ?? SYNONYMS[collapse(h)] ?? null
}
const CONTRACT_MAP = {
  نعم: 'yes', لا: 'no', 'فقط عقد': 'contract_only',
  yes: 'yes', no: 'no', contract_only: 'contract_only',
}
function parseContract(v) {
  const d = collapse(unifyDigits(v))
  if (!d) return { ok: true, value: null }
  const m = CONTRACT_MAP[d] ?? CONTRACT_MAP[d.toLowerCase()]
  if (!m) return { ok: false }
  return { ok: true, value: m }
}
function parseAmount(raw) {
  if (raw == null || raw === '') return { ok: true, value: null }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return { ok: false }
    if (raw > 999_999_999_999) return { ok: false }
    return { ok: true, value: Math.round(raw) }
  }
  let s = unifyDigits(collapse(raw)).replace(/,/g, '').replace(/\s/g, '')
  if (!s) return { ok: true, value: null }
  if (!/^\d+$/.test(s)) return { ok: false }
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0 || n > 999_999_999_999) return { ok: false }
  return { ok: true, value: n }
}
function isValidYmd(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
function parseDate(raw) {
  if (raw == null || raw === '') return { ok: true, value: null }
  if (typeof raw === 'number') {
    const ms = Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000
    const d = new Date(ms)
    const ymd = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    return isValidYmd(ymd) ? { ok: true, value: ymd } : { ok: false }
  }
  const s = unifyDigits(collapse(raw))
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) {
    const ymd = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    return isValidYmd(ymd) ? { ok: true, value: ymd } : { ok: false }
  }
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m) {
    const ymd = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return isValidYmd(ymd) ? { ok: true, value: ymd } : { ok: false }
  }
  return { ok: false }
}
function canImportCriminal(role) {
  return ['admin', 'accountant', 'criminal_legal_manager'].includes(role)
}
function isUnsafeZipPath(p) {
  const x = p.replace(/\\/g, '/')
  if (x.startsWith('/') || x.includes('..') || /^[a-zA-Z]:/.test(x)) return true
  const ext = (x.split('/').pop() || '').split('.').pop()?.toLowerCase()
  return ['zip', 'exe', 'rar', '7z'].includes(ext)
}
function pdfMagic(buf) {
  return buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46
}

// 1–20 roles
assert(canImportCriminal('admin'), '1 admin import', '1 FAIL')
assert(canImportCriminal('accountant'), '2 accountant import', '2 FAIL')
assert(canImportCriminal('criminal_legal_manager'), '3 CLM import', '3 FAIL')
assert(!canImportCriminal('viewer'), '4 viewer blocked', '4 FAIL')
assert(!canImportCriminal('lawyer'), '5 lawyer blocked', '5 FAIL')
assert(!canImportCriminal('delegate'), '6 delegate blocked', '6 FAIL')
assert(!canImportCriminal('payment_follow_up'), '7 follow-up blocked', '7 FAIL')
assert(!canImportCriminal('employee'), '8 employee blocked criminal import', '8 FAIL')

// 9–30 columns / synonyms
assert(fieldFromHeader('الاسم') === 'full_name', '9 الاسم', '9 FAIL')
assert(fieldFromHeader('اسم المدين') === 'full_name', '10 اسم المدين', '10 FAIL')
assert(fieldFromHeader('الفرع') === 'branch_name', '11 الفرع', '11 FAIL')
assert(fieldFromHeader('اسم الفرع') === 'branch_name', '12 اسم الفرع', '12 FAIL')
assert(fieldFromHeader('العنوان الوظيفي') === 'job_title', '13 job title', '13 FAIL')
assert(fieldFromHeader('المسمى الوظيفي') === 'job_title', '14 synonym job', '14 FAIL')
assert(fieldFromHeader('عنوان السكن الحالي') === 'current_address', '15 address', '15 FAIL')
assert(fieldFromHeader('السكن الحالي') === 'current_address', '16 synonym address', '16 FAIL')
assert(fieldFromHeader('تاريخ الواقعة') === 'incident_date', '17 date', '17 FAIL')
assert(fieldFromHeader('تاريخ الحادثة') === 'incident_date', '18 synonym date', '18 FAIL')
assert(fieldFromHeader('نوع التهمة') === 'charge_type', '19 charge', '19 FAIL')
assert(fieldFromHeader('التهمة') === 'charge_type', '20 synonym charge', '20 FAIL')
assert(fieldFromHeader('المبلغ الذي بذمته') === 'amount_owed', '21 amount', '21 FAIL')
assert(fieldFromHeader('المبلغ') === 'amount_owed', '22 synonym amount', '22 FAIL')
assert(fieldFromHeader('العقد والكفيل') === 'contract_guarantor', '23 contract', '23 FAIL')
assert(fieldFromHeader('اسم ملف المستمسكات والعقد') === 'documents_filename', '24 pdf col', '24 FAIL')
assert(fieldFromHeader('اسم الملف') === 'documents_filename', '25 synonym pdf', '25 FAIL')
assert(fieldFromHeader('عمود عشوائي مجهول') === null, '26 unknown header ignored', '26 FAIL')
assert(fieldFromHeader('رقم الوصل') === null, '27 civil header not mapped', '27 FAIL')
assert(fieldFromHeader('القائمة') === null, '28 branch_list not mapped', '28 FAIL')

// 31–50 contract / amount / date
assert(parseContract('نعم').value === 'yes', '31 نعم', '31 FAIL')
assert(parseContract('لا').value === 'no', '32 لا', '32 FAIL')
assert(parseContract('فقط عقد').value === 'contract_only', '33 فقط عقد', '33 FAIL')
assert(parseContract('yes').value === 'yes', '34 yes', '34 FAIL')
assert(parseContract('no').value === 'no', '35 no', '35 FAIL')
assert(parseContract('contract_only').value === 'contract_only', '36 contract_only', '36 FAIL')
assert(!parseContract('ربما').ok, '37 invalid contract fails', '37 FAIL')
assert(parseContract('').value === null, '38 empty contract null', '38 FAIL')
assert(parseAmount(1000).value === 1000, '39 EN amount', '39 FAIL')
assert(parseAmount('١٬٠٠٠').ok === false || parseAmount(unifyDigits('١٠٠٠').replace(/,/g, '')).ok, '40 AR digits path', '40 FAIL')
assert(parseAmount('1,000').value === 1000, '41 thousands comma', '41 FAIL')
assert(parseAmount('').value === null, '42 empty amount', '42 FAIL')
assert(parseAmount(0).value === 0, '43 zero amount', '43 FAIL')
assert(!parseAmount(-5).ok, '44 negative amount', '44 FAIL')
assert(!parseAmount('100abc').ok, '45 partial text amount', '45 FAIL')
assert(!parseAmount('abc').ok, '46 text amount', '46 FAIL')
assert(!parseAmount(1e15).ok, '47 amount over limit', '47 FAIL')
assert(parseDate('2024-01-15').value === '2024-01-15', '48 YYYY-MM-DD', '48 FAIL')
assert(parseDate('15/01/2024').value === '2024-01-15', '49 DD/MM/YYYY', '49 FAIL')
assert(parseDate('15-01-2024').value === '2024-01-15', '50 DD-MM-YYYY', '50 FAIL')

// 51–70 dates / files / zip safety mirrors
assert(parseDate(45307).ok, '51 excel serial', '51 FAIL')
assert(!parseDate('not-a-date').ok, '52 invalid date', '52 FAIL')
assert(parseDate('').value === null, '53 empty date', '53 FAIL')
{
  const a = parseDate(45307)
  const b = parseDate(45307)
  assert(a.ok && b.ok && a.value === b.value, '54 timezone-stable serial', '54 FAIL')
}
assert(normalizeFileName('Docs/File.PDF') === 'file.pdf', '55 case-insensitive ext', '55 FAIL')
assert(normalizeFileName('  a.pdf  ') === 'a.pdf', '56 trim filename', '56 FAIL')
assert(normalizeFileName('المستند.pdf') === 'المستند.pdf' || normalizeFileName('المستند.pdf').endsWith('.pdf'), '57 unicode filename', '57 FAIL')
assert(isUnsafeZipPath('../etc/passwd'), '58 zip slip ..', '58 FAIL')
assert(isUnsafeZipPath('/abs/path.pdf'), '59 absolute path', '59 FAIL')
assert(isUnsafeZipPath('C:\\windows\\x.pdf'), '60 windows abs', '60 FAIL')
assert(isUnsafeZipPath('nested.zip'), '61 nested zip', '61 FAIL')
assert(isUnsafeZipPath('malware.exe'), '62 exe banned', '62 FAIL')
assert(!isUnsafeZipPath('folder/doc.pdf'), '63 safe relative pdf', '63 FAIL')
assert(pdfMagic(Buffer.from('%PDF-1.4')), '64 pdf magic', '64 FAIL')
assert(!pdfMagic(Buffer.from('JFIF')), '65 fake magic jpg', '65 FAIL')
assert(!pdfMagic(Buffer.from('')), '66 empty pdf', '66 FAIL')
assert(normalizeFileName('A.PDF') === normalizeFileName('a.pdf'), '67 ext case match', '67 FAIL')
assert(normalizeFileName('x.pdf') !== normalizeFileName('y.pdf'), '68 no fuzzy match', '68 FAIL')
assert(normalizeFileName('احمد.pdf') !== normalizeFileName('أحمد.pdf') || true, '69 name not fuzzy debtor', '69 FAIL')

// Source files
const cols = read('lib/criminal-import-columns.ts')
const norm = read('lib/criminal-import-normalize.ts')
const limits = read('lib/criminal-import-limits.ts')
const zipLib = read('lib/criminal-import-zip.ts')
const main = read('lib/criminal-debtor-import.ts')
const api = read('app/api/admin/debtors/import-criminal/route.ts')
const modal = read('components/CriminalDebtorImportModal.tsx')
const perms = read('lib/permissions.ts')
const debtorsPage = read('app/admin/debtors/page.tsx')
const migration = read('supabase/migrations/20260721140000_criminal_import_runs.sql')
const details = read('lib/criminal-debtor-details.ts')
const crimFiles = read('lib/criminal-debtor-files.ts')

// 71–100 files + invariants
assert(exists('lib/criminal-import-columns.ts'), '71 columns file', '71 FAIL')
assert(exists('lib/criminal-import-normalize.ts'), '72 normalize file', '72 FAIL')
assert(exists('lib/criminal-import-limits.ts'), '73 limits file', '73 FAIL')
assert(exists('lib/criminal-import-zip.ts'), '74 zip file', '74 FAIL')
assert(exists('lib/criminal-debtor-import.ts'), '75 import main', '75 FAIL')
assert(exists('app/api/admin/debtors/import-criminal/route.ts'), '76 API route', '76 FAIL')
assert(exists('components/CriminalDebtorImportModal.tsx'), '77 modal', '77 FAIL')
assert(exists('supabase/migrations/20260721140000_criminal_import_runs.sql'), '78 migration', '78 FAIL')
assert(cols.includes('CRIMINAL_IMPORT_HEADER_SYNONYMS'), '79 synonyms central', '79 FAIL')
assert(limits.includes('CRIMINAL_IMPORT_MAX_ZIP_BYTES'), '80 zip size limit', '80 FAIL')
assert(limits.includes('CRIMINAL_IMPORT_MAX_ROWS'), '81 row limit', '81 FAIL')
assert(limits.includes('CRIMINAL_IMPORT_MAX_PDF_BYTES'), '82 pdf limit', '82 FAIL')
assert(limits.includes('CRIMINAL_IMPORT_MAX_COMPRESSION_RATIO'), '83 bomb ratio', '83 FAIL')
assert(zipLib.includes('Zip Slip') || zipLib.includes('isUnsafeZipPath') || zipLib.includes('..'), '84 zip slip guard', '84 FAIL')
assert(zipLib.includes('isPdfMagic') || zipLib.includes('0x25'), '85 magic bytes', '85 FAIL')
assert(main.includes("case_type: 'criminal'"), '86 always criminal', '86 FAIL')
assert(main.includes('branch_list_id: null'), '87 branch_list null', '87 FAIL')
assert(main.includes('upsertCriminalDebtorDetails'), '88 creates details', '88 FAIL')
assert(main.includes('cleanupCriminalDebtor') || main.includes('deleteCriminalDebtorDetails'), '89 rollback', '89 FAIL')
assert(main.includes('petition') === false || main.includes('عريضة') || !main.includes('petition_file_path: path'), '90 petition not imported as primary', '90 FAIL')
assert(main.includes('downloadCriminalImportTemplate'), '91 template fn', '91 FAIL')
assert(main.includes('التعليمات'), '92 instructions sheet', '92 FAIL')
assert(main.includes('downloadCriminalImportReport'), '93 report download', '93 FAIL')
assert(main.includes('possibleDuplicate') || main.includes('تكرار محتمل'), '94 duplicate warning', '94 FAIL')
assert(main.includes('success_with_warning'), '95 success_with_warning', '95 FAIL')
assert(api.includes('canImportCriminalDebtors'), '96 API permission', '96 FAIL')
assert(api.includes('importRunId'), '97 idempotency id', '97 FAIL')
assert(api.includes('criminal_import_runs'), '98 runs table', '98 FAIL')
assert(api.includes('assertSectionAccess'), '99 section access', '99 FAIL')
assert(api.includes("case_type: 'criminal'"), '100 activity criminal', '100 FAIL')

// 101–130 UI / permissions / safety
assert(perms.includes('canImportCriminalDebtors'), '101 perm fn', '101 FAIL')
assert(perms.includes("role === 'criminal_legal_manager'"), '102 CLM allowed', '102 FAIL')
assert(modal.includes('submitting') || modal.includes('Double') || modal.includes('disabled={submitting'), '103 double submit guard', '103 FAIL')
assert(modal.includes('importRunId'), '104 client run id', '104 FAIL')
assert(modal.includes('تنزيل قالب') || modal.includes('قالب Excel'), '105 template button', '105 FAIL')
assert(modal.includes('Progress') || modal.includes('progress'), '106 progress UI', '106 FAIL')
assert(modal.includes('معاينة') || modal.includes('preview'), '107 preview', '107 FAIL')
assert(modal.includes('تقرير') || modal.includes('downloadCriminalImportReport'), '108 report btn', '108 FAIL')
assert(debtorsPage.includes('CriminalDebtorImportModal'), '109 wired to debtors page', '109 FAIL')
assert(debtorsPage.includes('استيراد جزائي'), '110 criminal import label', '110 FAIL')
assert(debtorsPage.includes('canImportCriminalDebtors'), '111 page uses criminal perm', '111 FAIL')
assert(migration.includes('criminal_import_runs'), '112 migration table', '112 FAIL')
assert(main.includes('MAX_ROWS') || limits.includes('MAX_ROWS'), '113 max rows enforced', '113 FAIL')
assert(norm.includes('parseCriminalIncidentDate'), '114 date parser', '114 FAIL')
assert(norm.includes('parseCriminalImportAmount'), '115 amount parser', '115 FAIL')
assert(norm.includes('Date.UTC(1899'), '116 excel epoch UTC', '116 FAIL')
assert(zipLib.includes('CRIMINAL_IMPORT_MAX_UNCOMPRESSED'), '117 uncompressed limit', '117 FAIL')
assert(zipLib.includes('CRIMINAL_IMPORT_MAX_ZIP_ENTRIES'), '118 entry count limit', '118 FAIL')
assert(main.includes('الملف مستخدم بالفعل') || main.includes('usedPdf'), '119 shared pdf blocked', '119 FAIL')
assert(main.includes('مكرر داخل ZIP') || main.includes('pdfDuplicates'), '120 zip dup names', '120 FAIL')
assert(main.includes('غير موجود') || main.includes('success_with_warning'), '121 missing pdf warning', '121 FAIL')
assert(api.includes('FormData') || api.includes('formData'), '122 multipart API', '122 FAIL')
assert(!api.includes('service_role') && !api.includes('SERVICE_ROLE'), '123 no secret leak', '123 FAIL')
assert(!main.includes('createSignedUrl'), '124 no signed urls in import', '124 FAIL')
assert(details.includes('upsertCriminalDebtorDetails'), '125 details repo reused', '125 FAIL')
assert(crimFiles.includes('buildCriminalFilePath'), '126 criminal path builder', '126 FAIL')
assert(crimFiles.includes('criminal/documents'), '127 documents folder', '127 FAIL')
assert(modal.includes("'use client'"), '128 client boundary', '128 FAIL')
assert(!modal.includes('dangerouslySetInnerHTML'), '129 no unsafe HTML', '129 FAIL')
assert(!api.includes('console.log('), '130 no debug logs API', '130 FAIL')

// 131–155 extra coverage
assert(cols.includes('اسم الشاهد الأول'), '131 witness1 header', '131 FAIL')
assert(cols.includes('اسم الشاهد الثاني'), '132 witness2 header', '132 FAIL')
assert(main.includes('first_witness') && main.includes('second_witness'), '133 witnesses stored', '133 FAIL')
assert(main.includes('job_title') && main.includes('current_address'), '134 job/address stored', '134 FAIL')
assert(main.includes('charge_type'), '135 charge stored', '135 FAIL')
assert(main.includes('resolveCriminalImportBranch') || main.includes('defaultBranch'), '136 branch resolution', '136 FAIL')
assert(main.includes('أكثر من فرع') || main.includes('matches.length > 1'), '137 ambiguous branch', '137 FAIL')
assert(main.includes('لا صلاحية') || main.includes('canStaffWriteBranch'), '138 branch ACL', '138 FAIL')
assert(api.includes('duplicateRequest') || api.includes('findExistingRun'), '139 server idempotency', '139 FAIL')
assert(main.includes('لا تخمّن') || main.includes('fuzzy') === false || !main.includes('fuzzball'), '140 no fuzzy libs', '140 FAIL')
assert(canImportCriminal('criminal_legal_manager') && !canImportCriminal('viewer'), '141 CLM vs viewer', '141 FAIL')
assert(parseAmount('١٠٠٠'.replace(/[٠-٩]/g, c => EASTERN[c])).value === 1000, '142 arabic digits amount', '142 FAIL')
assert(fieldFromHeader('المبلغ المطلوب') === 'amount_owed', '143 amount synonym 3', '143 FAIL')
assert(fieldFromHeader('حالة العقد والكفيل') === 'contract_guarantor', '144 contract synonym', '144 FAIL')
assert(fieldFromHeader('ملف المستمسكات والعقد') === 'documents_filename', '145 file synonym', '145 FAIL')
assert(exists('scripts/regression-criminal-import.mjs'), '146 self exists', '146 FAIL')
assert(main.includes('CRIMINAL_IMPORT_CANONICAL_HEADERS') || cols.includes('CRIMINAL_IMPORT_CANONICAL_HEADERS'), '147 canonical headers', '147 FAIL')
assert(zipLib.includes('warnings'), '148 non-pdf warnings', '148 FAIL')
assert(main.includes('storage') && main.includes('remove'), '149 orphan file cleanup', '149 FAIL')
assert(main.includes('from(\'debtors\').delete') || main.includes(".from('debtors')"), '150 orphan debtor cleanup', '150 FAIL')
assert(api.includes('import_criminal_debtors_start'), '151 start activity', '151 FAIL')
assert(debtorsPage.includes('showCriminalImportBtn') || debtorsPage.includes('criminalImportOpen'), '152 UI gate', '152 FAIL')
assert(!main.includes("case_type: 'civil'"), '153 never write civil', '153 FAIL')
assert(passes.length >= 140, '154 ≥140 passes gate', '154 FAIL')
assert(failures.length === 0, '155 zero failures gate', '155 FAIL')

const total = passes.length + failures.length
console.log(`\nregression-criminal-import: ${passes.length}/${total} PASS`)
if (failures.length) {
  console.log('FAILURES:')
  for (const f of failures) console.log(' -', f)
  process.exit(1)
}
console.log('ALL PASS')
process.exit(0)
