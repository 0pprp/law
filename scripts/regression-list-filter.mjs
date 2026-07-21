/**
 * Regression audit for global list filter (branch_list).
 * Verifies wiring + cookie/API contracts without browser auth.
 * Run: node scripts/regression-list-filter.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const passes = []

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function assert(cond, okMsg, failMsg) {
  if (cond) passes.push(okMsg)
  else failures.push(failMsg)
}

// --- Scenario contracts (code-level) ---

const setBranch = read('app/api/admin/set-branch/route.ts')
assert(
  setBranch.includes('BRANCH_LIST_COOKIE') && setBranch.includes('maxAge: 0'),
  'OK: set-branch clears list cookie on branch change / view-all',
  'FAIL: set-branch must clear BRANCH_LIST_COOKIE (maxAge: 0)',
)

const setList = read('app/api/admin/set-branch-list/route.ts')
assert(
  setList.includes('.eq(\'branch_id\', branchId)') && setList.includes('reset: true'),
  'OK: set-branch-list validates list belongs to current branch',
  'FAIL: set-branch-list must validate list against branch and reset invalid',
)

const layout = read('app/admin/layout.tsx')
assert(
  layout.includes('BRANCH_LIST_COOKIE') &&
    layout.includes('.eq(\'branch_id\', initialBranchId)') &&
    layout.includes('maxAge: 0'),
  'OK: layout ignores/clears cross-branch list cookie on hydrate',
  'FAIL: layout must ignore invalid listId and clear cookie',
)

const branchCtx = read('context/branch.tsx')
assert(
  branchCtx.includes('setListId(null)') &&
    branchCtx.includes('setBranch') &&
    /setBranch[\s\S]*setListId\(null\)/.test(branchCtx),
  'OK: context clears listId when branch changes',
  'FAIL: BranchProvider.setBranch must clear listId',
)

const debtorsApi = read('app/api/admin/debtors/route.ts')
assert(
  debtorsApi.includes('listId') &&
    debtorsApi.includes('branch_lists') &&
    debtorsApi.includes('منع تسريب'),
  'OK: debtors API rejects listId outside branch scope',
  'FAIL: debtors API must validate listId against branch',
)

// Pages that browse debtor-scoped data must use list filter
const mustWire = [
  ['app/admin/debtors/page.tsx', /listId|filterListId|branchListId/],
  ['app/admin/tasks/page.tsx', /branchListId|filterListId/],
  ['app/admin/tasks/review/page.tsx', /branchListId/],
  ['app/admin/reports/page.tsx', /branchListId|listId/],
  ['app/admin/dashboard/page.tsx', /listId|branchListId/],
  ['app/admin/payments/page.tsx', /listId|scopeListId/],
  ['app/admin/expenses/page.tsx', /listId|scopeListId/],
  ['app/admin/closed-cases/page.tsx', /branchListId/],
  ['app/admin/payment-follow-up/page.tsx', /branchListId|scopeListId/],
  ['app/admin/accounts/page.tsx', /branch_list_id|listId/],
  ['app/admin/task-files/page.tsx', /listId|scopeListId|branch_list_id/],
  ['app/admin/delegates/report/page.tsx', /listId|scopeListId/],
  ['app/admin/dashboard/awaiting-assignment/page.tsx', /listId/],
  ['app/admin/dashboard/payment-in-progress/page.tsx', /listId/],
  ['app/admin/dashboard/noncompliance/page.tsx', /listId/],
  ['app/admin/dashboard/stages/[id]/page.tsx', /filterListId|branchListId/],
  ['components/PaymentOpsCards.tsx', /listScope|listId/],
  ['components/PaymentNoncomplianceRequestsCard.tsx', /listId/],
  ['lib/task-assignment.ts', /branchListId/],
  ['lib/payment-noncompliance.ts', /branchListId/],
  ['lib/fetch-closed-debtors.ts', /branchListId/],
  ['lib/delegate-wallet.ts', /branchListId|listFilter/],
]

for (const [rel, re] of mustWire) {
  const src = read(rel)
  assert(re.test(src), `OK: list filter wired in ${rel}`, `FAIL: missing list filter in ${rel}`)
}

// Staff/CRUD surfaces intentionally skip list filter
const intentionallySkip = [
  'app/admin/activity/page.tsx',
  'app/admin/settings/page.tsx',
  'app/admin/lawyers/page.tsx',
  'app/admin/delegates/page.tsx',
]
for (const rel of intentionallySkip) {
  const src = read(rel)
  assert(
    !/branchListId|scopeListId/.test(src),
    `OK: ${rel} correctly skips list filter (staff/CRUD)`,
    `NOTE: ${rel} unexpectedly references list filter`,
  )
}

// Network param contract: debtors client must send listId with branch
const debtorsPage = read('app/admin/debtors/page.tsx')
assert(
  debtorsPage.includes('params.set(\'listId\'') || debtorsPage.includes('params.set("listId"'),
  'OK: debtors page sends listId query param',
  'FAIL: debtors page must send listId on network requests',
)

console.log('\n=== List-filter regression audit ===\n')
for (const p of passes) console.log('  ✓', p)
if (failures.length) {
  console.log('')
  for (const f of failures) console.log('  ✗', f)
  console.log(`\nFAILED: ${failures.length} issue(s), ${passes.length} passed\n`)
  process.exit(1)
}
console.log(`\nPASSED: ${passes.length} checks\n`)
console.log('Manual UI checklist (browser):')
console.log('  1-5  Baghdad → list → debtor detail → back → filters unchanged')
console.log('  6-9  Switch to Babil → listId empty, cookie cleared, data not empty from stale list')
console.log(' 10-11 Cross-branch list cookie ignored + cleared on layout hydrate')
console.log(' 12-13 Network: branch_id + listId only when valid for branch')
process.exit(0)
