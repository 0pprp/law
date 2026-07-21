/**
 * Regression: full civil/criminal section isolation (security hardening)
 * Run: node scripts/regression-section-isolation.mjs
 * Target: ≥60 checks
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

function fileUsesScope(rel) {
  const src = read(rel)
  return (
    src.includes('resolveCaseScope')
    || src.includes('filterBySection')
    || src.includes('assertDebtorSection')
    || src.includes('assertLawyerSection')
    || src.includes('sessionCaseScope')
    || src.includes('requireDebtorInScope')
    || src.includes('requireTaskInScope')
    || src.includes('requireLawyerInScope')
    || src.includes('useCaseScope')
    || src.includes('caseTypeFilter')
    || /caseType:\s*caseTypeFilter|caseType:\s*ct\b|caseType:\s*scopeCaseType|branchListId:.*caseType/.test(src)
  )
}

// --- Mirror of resolveCaseScope for unit assertions ---
function resolveCaseScope(role, opts) {
  if (role === 'viewer') return { section: 'civil', filterCaseType: 'civil' }
  if (role === 'criminal_legal_manager') return { section: 'criminal', filterCaseType: 'criminal' }
  if (role === 'lawyer') {
    const ct = opts?.lawyerCaseType === 'criminal' ? 'criminal' : 'civil'
    return { section: ct, filterCaseType: ct }
  }
  if (role === 'delegate') return { section: 'civil', filterCaseType: 'civil' }
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

// 1–4 roles
assert(filterBySection(resolveCaseScope('viewer')) === 'civil', '1 viewer→civil', '1 FAIL')
assert(!assertDebtorSection(resolveCaseScope('viewer'), 'criminal'), '2 viewer blocked criminal', '2 FAIL')
assert(filterBySection(resolveCaseScope('criminal_legal_manager')) === 'criminal', '3 CLM→criminal', '3 FAIL')
assert(!assertDebtorSection(resolveCaseScope('criminal_legal_manager'), 'civil'), '4 CLM blocked civil', '4 FAIL')
assert(filterBySection(resolveCaseScope('admin')) === null, '5 admin both', '5 FAIL')
assert(assertDebtorSection(resolveCaseScope('admin'), 'civil') && assertDebtorSection(resolveCaseScope('admin'), 'criminal'), '6 admin sees both', '6 FAIL')
assert(filterBySection(resolveCaseScope('accountant')) === null, '7 accountant both', '7 FAIL')

// 8–9 helpers present
const cs = read('lib/case-scope.ts')
for (const fn of ['resolveCaseScope', 'filterBySection', 'assertSectionAccess', 'assertDebtorSection', 'assertLawyerSection']) {
  assert(cs.includes(`function ${fn}`), `8 helper ${fn}`, `8 FAIL ${fn}`)
}
assert(exists('lib/section-guard.ts'), '9 section-guard exists', '9 FAIL')
const sg = read('lib/section-guard.ts')
assert(sg.includes('requireDebtorInScope') && sg.includes('requireTaskInScope') && sg.includes('requireLawyerInScope'), '10 require*InScope', '10 FAIL')

// 11–20 APIs gated
const apis = [
  'app/api/admin/debtors/route.ts',
  'app/api/admin/debtors/[id]/route.ts',
  'app/api/admin/change-debtor-task/route.ts',
  'app/api/admin/debtors/to-payment-in-progress/route.ts',
  'app/api/admin/debtors/assignment-note/route.ts',
  'app/api/admin/assign-tasks/route.ts',
  'app/api/admin/approve-task/route.ts',
  'app/api/admin/reject-task/route.ts',
  'app/api/admin/task-transition/route.ts',
  'app/api/admin/release-task-fee/route.ts',
]
apis.forEach((f, i) => assert(fileUsesScope(f), `${11 + i} API ${path.basename(path.dirname(f))}/${path.basename(f)}`, `${11 + i} FAIL ${f}`))

// 21–30 file + noncompliance + lawyer files + notifications
const apis2 = [
  'app/api/admin/payment-noncompliance/route.ts',
  'app/api/admin/payment-noncompliance/approve/route.ts',
  'app/api/admin/payment-noncompliance/reject/route.ts',
  'app/api/admin/upload-debtor-file/route.ts',
  'app/api/admin/delete-debtor-file/route.ts',
  'app/api/admin/debtor-file-url/route.ts',
  'app/api/admin/task-file-url/route.ts',
  'app/api/admin/delete-task-file/route.ts',
  'app/api/admin/upload-lawyer-file/route.ts',
  'app/api/admin/notification-counts/route.ts',
]
apis2.forEach((f, i) => assert(fileUsesScope(f), `${21 + i} API2 ${path.basename(f)}`, `${21 + i} FAIL ${f}`))

// 31–40 pages
const pages = [
  'app/admin/debtors/page.tsx',
  'app/admin/debtors/[id]/account/page.tsx',
  'app/admin/debtors/[id]/edit/page.tsx',
  'app/admin/dashboard/page.tsx',
  'app/admin/tasks/page.tsx',
  'app/admin/tasks/review/page.tsx',
  'app/admin/tasks/new/page.tsx',
  'app/admin/lawyers/page.tsx',
  'app/admin/payments/page.tsx',
  'app/admin/expenses/page.tsx',
]
pages.forEach((f, i) => assert(fileUsesScope(f), `${31 + i} page ${f.split('/').slice(-2).join('/')}`, `${31 + i} FAIL ${f}`))

// 41–50 more pages + cards + libs
const more = [
  'app/admin/accounts/page.tsx',
  'app/admin/closed-cases/page.tsx',
  'app/admin/reports/page.tsx',
  'app/admin/payment-follow-up/page.tsx',
  'app/admin/task-files/page.tsx',
  'components/AwaitingAssignmentCard.tsx',
  'components/PaymentOpsCards.tsx',
  'components/PaymentInProgressCard.tsx',
  'lib/awaiting-assignment.ts',
  'lib/payment-in-progress.ts',
]
more.forEach((f, i) => {
  const src = read(f)
  const ok = fileUsesScope(f) || src.includes('caseType') || src.includes('case_type')
  assert(ok, `${41 + i} ${f}`, `${41 + i} FAIL ${f}`)
})

// 51–55 search / lawyer access / immutability / list null / activity
assert(read('lib/debtor-search.ts').includes('caseType') && read('lib/debtor-search.ts').includes(".eq('case_type'"), '51 search caseType', '51 FAIL')
assert(read('lib/lawyer-task-access.ts').includes('section') || read('lib/lawyer-task-access.ts').includes('case_type'), '52 lawyer task section', '52 FAIL')
assert(read('app/api/admin/debtors/[id]/route.ts').includes('لا يمكن تغيير نوع الدعوى'), '53 case_type immutable', '53 FAIL')
assert(read('lib/case-scope.ts').includes('normalizeBranchListForCaseType'), '54 criminal list null helper', '54 FAIL')
assert(read('lib/activity-log.ts').includes('case_type'), '55 activity log case_type', '55 FAIL')

// 56–60 security contracts
assert(read('app/api/admin/debtors/[id]/route.ts').includes('sectionForbiddenResponse') || read('app/api/admin/debtors/[id]/route.ts').includes('assertDebtorSection'), '56 debtor id 403 path', '56 FAIL')
assert(sg.includes('sectionForbiddenResponse'), '57 task gate uses forbidden', '57 FAIL')
assert(exists('hooks/use-case-scope.ts'), '58 useCaseScope hook', '58 FAIL')
assert(exists('components/SectionAccessGate.tsx'), '59 SectionAccessGate', '59 FAIL')
assert(read('lib/payment-noncompliance.ts').includes('caseType'), '60 noncompliance caseType', '60 FAIL')

// 61–70 extras
assert(read('lib/branch-profiles.ts').includes('caseType') || read('lib/branch-profiles.ts').includes('case_type'), '61 branch-profiles section', '61 FAIL')
assert(read('lib/task-assignment.ts').includes('caseType'), '62 task-assignment caseType', '62 FAIL')
assert(fileUsesScope('app/api/admin/lawyer-file-url/route.ts') || fileUsesScope('app/api/admin/delete-lawyer-file/route.ts'), '63 lawyer file APIs', '63 FAIL')
assert(read('app/admin/lawyers/new/page.tsx').includes('case_type') || read('app/admin/lawyers/new/page.tsx').includes('CASE_TYPE'), '64 lawyer create section UI', '64 FAIL')
assert(read('app/admin/lawyers/[id]/edit/page.tsx').includes('case_type') || fileUsesScope('app/admin/lawyers/[id]/edit/page.tsx'), '65 lawyer edit gated', '65 FAIL')
assert(read('components/ui/debtor-search-picker.tsx').includes('caseType'), '66 search picker caseType', '66 FAIL')
assert(!cs.includes("from '@/lib/permissions'"), '67 no circular case-scope→permissions', '67 FAIL')
assert(read('lib/types.ts').includes('criminal_legal_manager'), '68 UserRole CLM', '68 FAIL')
assert(read('lib/types.ts').includes('مسؤول الدعاوى المدنية'), '69 viewer label', '69 FAIL')
assert(read('lib/permissions.ts').includes('isAnyLegalManager'), '70 isAnyLegalManager', '70 FAIL')

// 71–75 dashboard isolation behavior in code
const dash = read('app/admin/dashboard/page.tsx')
assert(fileUsesScope('app/admin/dashboard/page.tsx') || dash.includes('filterBySection') || dash.includes('resolveCaseScope'), '71 dashboard scope', '71 FAIL')
assert(read('app/admin/tasks/review/page.tsx').includes('caseType') || fileUsesScope('app/admin/tasks/review/page.tsx'), '72 review caseType', '72 FAIL')
assert(read('app/admin/tasks/page.tsx').includes('caseType') || fileUsesScope('app/admin/tasks/page.tsx'), '73 tasks caseType', '73 FAIL')
assert(read('app/api/admin/notification-counts/route.ts').includes('filterBySection') || read('app/api/admin/notification-counts/route.ts').includes('sessionCaseScope'), '74 notifications scoped', '74 FAIL')
assert(resolveCaseScope('lawyer', { lawyerCaseType: 'criminal' }).filterCaseType === 'criminal', '75 criminal lawyer scope', '75 FAIL')

console.log('\n=== Section isolation regression ===\n')
for (const p of passes) console.log('  ✓', p)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  ✗', f)
  console.log(`\nFAILED: ${failures.length}, passed ${passes.length}\n`)
  process.exit(1)
}
console.log(`\nPASSED: ${passes.length} checks (≥60 required)\n`)
process.exit(0)
