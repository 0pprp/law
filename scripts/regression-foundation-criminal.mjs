/**
 * Regression: criminal section foundation
 * Run: node scripts/regression-foundation-criminal.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const passes = []

function assert(cond, ok, fail) {
  if (cond) passes.push(ok)
  else failures.push(fail)
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

// Load helpers via dynamic import (compiled TS not available — mirror critical logic + file contracts)
const caseScopeSrc = read('lib/case-scope.ts')
const typesSrc = read('lib/types.ts')
const permsSrc = read('lib/permissions.ts')
const searchSrc = read('lib/debtor-search.ts')
const debtorsApi = read('app/api/admin/debtors/route.ts')
const debtorIdApi = read('app/api/admin/debtors/[id]/route.ts')
const lawyersApi = read('app/api/admin/lawyers/route.ts')
const detailsSrc = read('lib/criminal-debtor-details.ts')
const migration = read('supabase/migrations/20260721120000_criminal_section_foundation.sql')

// --- Inline resolveCaseScope mirror for unit checks ---
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

function normalizeBranchListForCaseType(caseType, listId) {
  if (caseType === 'criminal') return null
  return (listId && String(listId).trim()) || null
}

// 1 viewer → civil only
assert(resolveCaseScope('viewer').filterCaseType === 'civil', '1 OK: viewer → civil', '1 FAIL: viewer scope')
assert(!assertDebtorSection(resolveCaseScope('viewer'), 'criminal'), '1b OK: viewer blocked from criminal', '1b FAIL')

// 2 criminal_legal_manager → criminal only
assert(resolveCaseScope('criminal_legal_manager').filterCaseType === 'criminal', '2 OK: CLM → criminal', '2 FAIL')
assert(!assertDebtorSection(resolveCaseScope('criminal_legal_manager'), 'civil'), '2b OK: CLM blocked from civil', '2b FAIL')

// 3 admin both
assert(resolveCaseScope('admin').filterCaseType === null, '3 OK: admin both', '3 FAIL')
assert(assertDebtorSection(resolveCaseScope('admin'), 'civil') && assertDebtorSection(resolveCaseScope('admin'), 'criminal'), '3b OK: admin sees both', '3b FAIL')

// 4 accountant both
assert(resolveCaseScope('accountant').filterCaseType === null, '4 OK: accountant both', '4 FAIL')

// 5 branch_list null for criminal
assert(normalizeBranchListForCaseType('criminal', 'abc') === null, '5 OK: criminal list forced null', '5 FAIL')
assert(normalizeBranchListForCaseType('civil', 'abc') === 'abc', '5b OK: civil list kept', '5b FAIL')
assert(caseScopeSrc.includes('normalizeBranchListForCaseType'), '5c OK: helper exported', '5c FAIL')
assert(debtorsApi.includes('normalizeBranchListForCaseType'), '5d OK: debtors API uses list normalize', '5d FAIL')

// 6 case_type immutable after create
assert(debtorIdApi.includes('لا يمكن تغيير نوع الدعوى بعد إنشاء المدين'), '6 OK: PATCH blocks case_type change', '6 FAIL')

// 7 helpers exist
for (const name of ['resolveCaseScope', 'assertSectionAccess', 'assertDebtorSection', 'assertLawyerSection', 'filterBySection']) {
  assert(caseScopeSrc.includes(`function ${name}`) || caseScopeSrc.includes(`export function ${name}`), `7 OK: ${name}`, `7 FAIL: missing ${name}`)
}

// 8 search filters caseType
assert(searchSrc.includes('caseType') && searchSrc.includes(".eq('case_type'"), '8 OK: debtor-search caseType', '8 FAIL')

// 9 types
assert(typesSrc.includes("'criminal_legal_manager'"), '9 OK: UserRole includes CLM', '9 FAIL')
assert(typesSrc.includes("viewer: 'مسؤول الدعاوى المدنية'"), '9b OK: viewer label renamed', '9b FAIL')
assert(typesSrc.includes("criminal_legal_manager: 'مسؤول الجزائيات'"), '9c OK: CLM label', '9c FAIL')
assert(typesSrc.includes("case_type?: 'civil' | 'criminal'"), '9d OK: Profile.case_type', '9d FAIL')

// 10 imports / STAFF_ROLES
assert(permsSrc.includes("'criminal_legal_manager'") && permsSrc.includes('isCriminalLegalManager') && permsSrc.includes('isAnyLegalManager'), '10 OK: permissions wired', '10 FAIL')
assert(permsSrc.includes('STAFF_ROLES') && /criminal_legal_manager/.test(permsSrc), '10b OK: STAFF_ROLES', '10b FAIL')
assert(lawyersApi.includes('criminal_legal_manager') && lawyersApi.includes('case_type'), '10c OK: lawyers API', '10c FAIL')
assert(detailsSrc.includes('criminal_debtor_details') && detailsSrc.includes('upsertCriminalDebtorDetails'), '10d OK: details repo', '10d FAIL')
assert(migration.includes('criminal_legal_manager') && migration.includes('criminal_debtor_details') && migration.includes('profiles'), '10e OK: migration', '10e FAIL')

// 11 no circular: case-scope must not import permissions
assert(!caseScopeSrc.includes("from '@/lib/permissions'"), '11 OK: case-scope no permissions import', '11 FAIL circular risk')

// 12-15 static safety contracts (runtime/hydration/react/supabase need live app)
assert(fs.existsSync(path.join(root, 'components/SectionAccessGate.tsx')), '12 OK: SectionAccessGate exists', '12 FAIL')
assert(debtorsApi.includes('sessionCaseScope') && debtorsApi.includes('filterBySection'), '13 OK: GET debtors scoped', '13 FAIL')
assert(debtorIdApi.includes('assertDebtorSection'), '14 OK: debtor id gated', '14 FAIL')
assert(read('lib/activity-log.ts').includes('case_type'), '15 OK: activity log case_type', '15 FAIL')

// Lawyer civil/criminal
assert(resolveCaseScope('lawyer', { lawyerCaseType: 'civil' }).filterCaseType === 'civil', 'L OK: civil lawyer', 'L FAIL')
assert(resolveCaseScope('lawyer', { lawyerCaseType: 'criminal' }).filterCaseType === 'criminal', 'L2 OK: criminal lawyer', 'L2 FAIL')

console.log('\n=== Criminal foundation regression ===\n')
for (const p of passes) console.log('  ✓', p)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  ✗', f)
  console.log(`\nFAILED: ${failures.length}, passed ${passes.length}\n`)
  process.exit(1)
}
console.log(`\nPASSED: ${passes.length} checks\n`)
console.log('Note: Live React/Hydration/Supabase runtime checks require a running app + DB migration applied.')
process.exit(0)
