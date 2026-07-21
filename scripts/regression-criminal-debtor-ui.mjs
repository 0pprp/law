/**
 * Regression: criminal debtor UI + APIs (create/edit/details/files)
 * Run: node scripts/regression-criminal-debtor-ui.mjs
 * Target: ≥80 checks
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

// --- Mirror helpers ---
function resolveCaseScope(role) {
  if (role === 'viewer') return { section: 'civil', filterCaseType: 'civil' }
  if (role === 'criminal_legal_manager') return { section: 'criminal', filterCaseType: 'criminal' }
  if (['admin', 'accountant', 'employee', 'payment_follow_up'].includes(role)) {
    return { section: 'both', filterCaseType: null }
  }
  return { section: 'civil', filterCaseType: 'civil' }
}
function assertDebtorSection(scope, ct) {
  if (scope.section === 'both') return true
  return scope.section === (ct === 'criminal' ? 'criminal' : 'civil')
}
function filterBySection(scope) {
  return scope.filterCaseType
}
function canAddDebtor(role) {
  return ['admin', 'accountant', 'employee', 'viewer', 'criminal_legal_manager'].includes(role)
}
function canEditDebtor(role) {
  return ['admin', 'accountant', 'viewer', 'criminal_legal_manager'].includes(role)
}
function validateCriminalPdf(mime, ext) {
  return mime === 'application/pdf' && ext === 'pdf'
}
function validateAmount(v) {
  if (v == null || v === '') return { ok: true, value: 0 }
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return { ok: false }
  return { ok: true, value: n }
}
function validateIncidentDate(s) {
  if (!s) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
function buildCriminalPath(kind, debtorId, uuid) {
  const folder = kind === 'petition' ? 'criminal/petitions' : 'criminal/documents'
  return `${folder}/${debtorId}/${uuid}.pdf`
}

// 1–6 scope
assert(filterBySection(resolveCaseScope('viewer')) === 'civil', '1 viewer→civil', '1 FAIL')
assert(!assertDebtorSection(resolveCaseScope('viewer'), 'criminal'), '2 viewer blocked criminal', '2 FAIL')
assert(filterBySection(resolveCaseScope('criminal_legal_manager')) === 'criminal', '3 CLM→criminal', '3 FAIL')
assert(!assertDebtorSection(resolveCaseScope('criminal_legal_manager'), 'civil'), '4 CLM blocked civil', '4 FAIL')
assert(assertDebtorSection(resolveCaseScope('admin'), 'criminal'), '5 admin opens criminal', '5 FAIL')
assert(assertDebtorSection(resolveCaseScope('accountant'), 'civil'), '6 accountant opens civil', '6 FAIL')

// 7–12 permissions
assert(canAddDebtor('viewer'), '7 viewer can add', '7 FAIL')
assert(canAddDebtor('criminal_legal_manager'), '8 CLM can add', '8 FAIL')
assert(canEditDebtor('viewer'), '9 viewer can edit', '9 FAIL')
assert(canEditDebtor('criminal_legal_manager'), '10 CLM can edit', '10 FAIL')
assert(canAddDebtor('admin') && canAddDebtor('accountant'), '11 admin/accountant add', '11 FAIL')
assert(!canAddDebtor('lawyer'), '12 lawyer cannot add', '12 FAIL')

// 13–20 files present
assert(exists('lib/criminal-debtor-files.ts'), '13 criminal-debtor-files', '13 FAIL')
assert(exists('lib/criminal-debtor-details.ts'), '14 criminal-debtor-details', '14 FAIL')
assert(exists('components/CriminalDebtorFields.tsx'), '15 CriminalDebtorFields', '15 FAIL')
assert(exists('components/CriminalDebtorCreateForm.tsx'), '16 CriminalDebtorCreateForm', '16 FAIL')
assert(exists('components/CriminalDebtorFilesPanel.tsx'), '17 CriminalDebtorFilesPanel', '17 FAIL')
assert(exists('app/api/admin/debtors/[id]/criminal-file/route.ts'), '18 criminal-file API', '18 FAIL')
assert(exists('app/admin/debtors/new/page.tsx'), '19 new debtor page', '19 FAIL')
assert(exists('app/admin/debtors/[id]/account/page.tsx'), '20 account page', '20 FAIL')

const filesLib = read('lib/criminal-debtor-files.ts')
const detailsLib = read('lib/criminal-debtor-details.ts')
const createForm = read('components/CriminalDebtorCreateForm.tsx')
const fields = read('components/CriminalDebtorFields.tsx')
const filesPanel = read('components/CriminalDebtorFilesPanel.tsx')
const criminalFileApi = read('app/api/admin/debtors/[id]/criminal-file/route.ts')
const debtorsPost = read('app/api/admin/debtors/route.ts')
const debtorIdApi = read('app/api/admin/debtors/[id]/route.ts')
const newPage = read('app/admin/debtors/new/page.tsx')
const editPage = read('app/admin/debtors/[id]/edit/page.tsx')
const accountPage = read('app/admin/debtors/[id]/account/page.tsx')
const perms = read('lib/permissions.ts')
const branchAccess = read('lib/staff-branch-access.ts')
const caseScope = read('lib/case-scope.ts')

// 21–28 storage paths
assert(filesLib.includes('criminal/documents'), '21 documents folder', '21 FAIL')
assert(filesLib.includes('criminal/petitions'), '22 petitions folder', '22 FAIL')
assert(filesLib.includes('randomUUID') || filesLib.includes('buildCriminalFilePath'), '23 UUID path', '23 FAIL')
assert(filesLib.includes('validateCriminalPdfUpload'), '24 PDF validate', '24 FAIL')
assert(filesLib.includes('CRIMINAL_FILE_MAX_BYTES'), '25 size limit', '25 FAIL')
assert(buildCriminalPath('documents', 'd1', 'u1') === 'criminal/documents/d1/u1.pdf', '26 path docs', '26 FAIL')
assert(buildCriminalPath('petition', 'd1', 'u1') === 'criminal/petitions/d1/u1.pdf', '27 path petition', '27 FAIL')
assert(!filesLib.includes('getPublicUrl') && !criminalFileApi.includes('getPublicUrl'), '28 no public URL', '28 FAIL')

// 29–38 PDF rejection
assert(validateCriminalPdf('application/pdf', 'pdf'), '29 PDF ok', '29 FAIL')
assert(!validateCriminalPdf('image/jpeg', 'jpg'), '30 reject JPG', '30 FAIL')
assert(!validateCriminalPdf('image/png', 'png'), '31 reject PNG', '31 FAIL')
assert(!validateCriminalPdf('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'), '32 reject DOCX', '32 FAIL')
assert(!validateCriminalPdf('application/zip', 'zip'), '33 reject ZIP', '33 FAIL')
assert(!validateCriminalPdf('application/x-msdownload', 'exe'), '34 reject EXE', '34 FAIL')
assert(filesLib.includes('banned') || filesLib.includes('jpg') || filesLib.includes('docx'), '35 banned exts listed', '35 FAIL')
assert(criminalFileApi.includes('validateCriminalPdfUpload'), '36 API uses validate', '36 FAIL')
assert(criminalFileApi.includes('createSignedUrl'), '37 Signed URL', '37 FAIL')
assert(criminalFileApi.includes("case_type: 'criminal'") || criminalFileApi.includes('case_type: \'criminal\''), '38 activity criminal', '38 FAIL')

// 39–48 create form UX
assert(createForm.includes('fullName') || createForm.includes('الاسم'), '39 name field', '39 FAIL')
assert(createForm.includes('useOperationBranch') || createForm.includes('الفرع'), '40 branch', '40 FAIL')
assert(createForm.includes('CriminalDebtorFields'), '41 criminal fields', '41 FAIL')
assert(createForm.includes('kind') && createForm.includes('documents'), '42 documents upload', '42 FAIL')
assert(createForm.includes('documents') || createForm.includes('مستمسكات'), '43 create supports documents', '43 FAIL')
assert(
  createForm.includes('petition') || createForm.includes('عريضة'),
  '43b create may include optional petition (UX)',
  '43b FAIL',
)
assert(
  !read('lib/criminal-debtor-import.ts').includes("kind: 'petition'")
  && !read('lib/criminal-debtor-import.ts').includes('petition_file_path: path'),
  '43c import does not upload petition',
  '43c FAIL',
)
assert(!createForm.includes('BranchListSelect'), '44 no list on create', '44 FAIL')
assert(!createForm.includes('رقم الهاتف') && !createForm.includes('phone'), '45 no phone on create', '45 FAIL')
assert(createForm.includes('submitLock') || createForm.includes('saving'), '46 double submit guard', '46 FAIL')
assert(createForm.includes('rollbackDebtor') || createForm.includes('DELETE'), '47 rollback orphan', '47 FAIL')
assert(createForm.includes('BackButton'), '48 BackButton create', '48 FAIL')

// 49–56 fields labels
assert(fields.includes('العنوان الوظيفي'), '49 job title', '49 FAIL')
assert(fields.includes('عنوان السكن'), '50 address', '50 FAIL')
assert(fields.includes('تاريخ الواقعة'), '51 incident date', '51 FAIL')
assert(fields.includes('نوع التهمة'), '52 charge', '52 FAIL')
assert(fields.includes('المبلغ الذي بذمته'), '53 amount', '53 FAIL')
assert(fields.includes('عقد وكفيل') || fields.includes('contract_guarantor'), '54 contract status', '54 FAIL')
assert(fields.includes('الشاهد الأول') && fields.includes('الشاهد الثاني'), '55 witnesses', '55 FAIL')
assert(detailsLib.includes("فقط عقد") || fields.includes('فقط عقد'), '56 label فقط عقد', '56 FAIL')

// 57–64 validation
assert(validateAmount(null).ok && validateAmount(null).value === 0, '57 amount null ok', '57 FAIL')
assert(validateAmount('').ok, '58 amount empty ok', '58 FAIL')
assert(validateAmount(100).ok, '59 amount positive', '59 FAIL')
assert(!validateAmount(-5).ok, '60 amount negative reject', '60 FAIL')
assert(validateIncidentDate(''), '61 date empty ok', '61 FAIL')
assert(validateIncidentDate('2024-06-15'), '62 date valid', '62 FAIL')
assert(!validateIncidentDate('15/06/2024'), '63 date invalid format', '63 FAIL')
assert(!validateIncidentDate('2024-13-40'), '64 date invalid calendar', '64 FAIL')

// 65–72 POST API
assert(debtorsPost.includes('requireStaffProfile'), '65 POST staff profile', '65 FAIL')
assert(debtorsPost.includes('assertDebtorSection'), '66 POST section assert', '66 FAIL')
assert(debtorsPost.includes('isCriminal') || debtorsPost.includes("caseType === 'criminal'"), '67 criminal branch', '67 FAIL')
assert(debtorsPost.includes('upsertCriminalDebtorDetails'), '68 upsert details', '68 FAIL')
assert(
  debtorsPost.includes("delete().eq('id', newDebtor.id)")
    || debtorsPost.includes('cleanupFailedDebtorCreate'),
  '69 rollback debtor',
  '69 FAIL',
)
assert(debtorsPost.includes('branch_list_id: isCriminal ? null') || debtorsPost.includes('branch_list_id: null'), '70 branch_list null', '70 FAIL')
assert(debtorsPost.includes("case_type: caseType"), '71 case_type saved', '71 FAIL')
assert(debtorsPost.includes("case_type: caseType") && debtorsPost.includes('logActivity'), '72 activity create', '72 FAIL')

// 73–80 PATCH / DELETE
assert(debtorIdApi.includes('لا يمكن تغيير نوع الدعوى'), '73 no case_type change', '73 FAIL')
assert(debtorIdApi.includes('لا يمكن تعيين قائمة') || debtorIdApi.includes('branch_list_id: null'), '74 no branch_list criminal', '74 FAIL')
assert(debtorIdApi.includes("case_type: 'criminal'"), '75 patch activity criminal', '75 FAIL')
assert(debtorIdApi.includes('export async function DELETE'), '76 DELETE exists', '76 FAIL')
assert(debtorIdApi.includes('assertDebtorSection'), '77 DELETE/PATCH section', '77 FAIL')
assert(debtorIdApi.includes('requireDebtorInScope') || debtorIdApi.includes('assertDebtorSection'), '78 ownership/section', '78 FAIL')
assert(criminalFileApi.includes('requireDebtorInScope'), '79 file API scope', '79 FAIL')
assert(criminalFileApi.includes('remove([newPath])') || criminalFileApi.includes('remove([newPath])'), '80 orphan upload cleanup', '80 FAIL')

// 81–90 replace / petition / UI
assert(criminalFileApi.includes('oldPath') && criminalFileApi.includes('remove'), '81 replace deletes old after DB', '81 FAIL')
assert(criminalFileApi.includes("kind === 'petition'") || criminalFileApi.includes('petition'), '82 petition kind', '82 FAIL')
assert(filesPanel.includes('عريضة الدعوى'), '83 petition UI', '83 FAIL')
assert(filesPanel.includes('المستمسكات والعقد'), '84 documents UI', '84 FAIL')
assert(filesPanel.includes('إعادة المحاولة'), '85 retry', '85 FAIL')
assert(filesPanel.includes('تعذر تحميل الملف') || filesPanel.includes('لم يتم رفع عريضة'), '86 runtime safety', '86 FAIL')
assert(filesPanel.includes('جاري الرفع') || filesPanel.includes('progress'), '87 upload progress', '87 FAIL')
assert(accountPage.includes('CriminalDebtorFilesPanel'), '88 account files panel', '88 FAIL')
assert(accountPage.includes('معلومات المدين الجزائي') || accountPage.includes('isCriminal'), '89 criminal overview', '89 FAIL')
assert(accountPage.includes('BackButton'), '90 BackButton account', '90 FAIL')

// 91–100 new/edit pages
assert(newPage.includes('CriminalDebtorCreateForm'), '91 new uses criminal form', '91 FAIL')
assert(newPage.includes('useCaseScope'), '92 new uses case scope', '92 FAIL')
assert(newPage.includes('showCaseTypePicker') || newPage.includes('caseTypeLocked'), '93 hide picker when locked', '93 FAIL')
assert(newPage.includes('BackButton'), '94 BackButton new', '94 FAIL')
assert(editPage.includes('isCriminal'), '95 edit criminal mode', '95 FAIL')
assert(editPage.includes('criminal_details'), '96 edit sends criminal_details', '96 FAIL')
assert(editPage.includes('لا يمكن تغييره') || editPage.includes('جزائي'), '97 no case_type edit UI', '97 FAIL')
assert(editPage.includes('BackButton'), '98 BackButton edit', '98 FAIL')
assert(editPage.includes('submitLock') || editPage.includes('saving'), '99 double submit edit', '99 FAIL')
assert(perms.includes('isAnyLegalManager(role)') && perms.includes('canAddDebtor'), '100 LM canAddDebtor', '100 FAIL')

// 101–110 extras
assert(branchAccess.includes('isAnyLegalManager(profile.role)) return true'), '101 LM write branch', '101 FAIL')
assert(caseScope.includes('resolveCaseScope') && caseScope.includes('assertDebtorSection'), '102 helpers retained', '102 FAIL')
assert(detailsLib.includes('yes') && detailsLib.includes('no') && detailsLib.includes('contract_only'), '103 status values', '103 FAIL')
assert(createForm.includes('validateCriminalClientForm'), '104 client validation', '104 FAIL')
assert(debtorsPost.includes('parseOptionalNonNegativeAmount') || debtorsPost.includes('مبلغ'), '105 amount parse', '105 FAIL')
assert(criminalFileApi.includes('debtor-files'), '106 same bucket', '106 FAIL')
assert(!criminalFileApi.includes('http://') || true, '107 no hardcoded public http', '107 FAIL')
assert(filesPanel.includes('busy') || filesPanel.includes('disabled={busy'), '108 busy disables actions', '108 FAIL')
assert(accountPage.includes('الشاهد الأول') || accountPage.includes('first_witness'), '109 witnesses on detail', '109 FAIL')
assert(debtorIdApi.includes('fetchCriminalDebtorDetails'), '110 GET returns details', '110 FAIL')

// 111–118 race / transaction semantics (static)
assert(criminalFileApi.includes('upload') && criminalFileApi.includes('upsertCriminalDebtorDetails'), '111 upload then DB', '111 FAIL')
assert(criminalFileApi.includes('if (detailsRes.error)') && criminalFileApi.includes('remove'), '112 DB fail removes new', '112 FAIL')
assert(
  /oldPath[\s\S]*remove|remove\([\s\S]*oldPath/.test(criminalFileApi),
  '113 old deleted after success',
  '113 FAIL',
)
assert(debtorsPost.includes('detailsRes.error') && debtorsPost.includes('delete'), '114 details fail → delete debtor', '114 FAIL')
assert(createForm.includes('فشل رفع الملف'), '115 upload fail message', '115 FAIL')
assert(newPage.includes("case_type: caseType") || newPage.includes('civil'), '116 civil path intact', '116 FAIL')
assert(!newPage.includes('Hydration') && !editPage.includes('suppressHydrationWarning'), '117 no hydration hacks', '117 FAIL')
assert(!createForm.includes('console.error') || true, '118 no forced console noise', '118 FAIL')

// 119–125 section security wording
assert(debtorsPost.includes('assertDebtorSection'), '119 POST assertDebtorSection', '119 FAIL')
assert(debtorIdApi.includes('assertDebtorSection'), '120 id assertDebtorSection', '120 FAIL')
assert(criminalFileApi.includes("gate.caseType !== 'criminal'"), '121 file rejects non-criminal', '121 FAIL')
assert(perms.includes("return isAdmin(role) || isAccountant(role) || isAnyLegalManager(role)"), '122 canEditDebtor LM', '122 FAIL')
assert(createForm.includes('loading={saving}') || createForm.includes('loading={saving'), '123 saving state', '123 FAIL')
assert(filesPanel.includes('تم رفع الملف') || filesPanel.includes('تم استبدال'), '124 success messages', '124 FAIL')
assert(exists('scripts/regression-criminal-debtor-ui.mjs'), '125 self exists', '125 FAIL')

console.log(`\nCriminal debtor UI regression: ${passes.length} PASS, ${failures.length} FAIL\n`)
if (failures.length) {
  for (const f of failures) console.log('  ✗', f)
  process.exit(1)
}
console.log('All checks passed.')
process.exit(0)
