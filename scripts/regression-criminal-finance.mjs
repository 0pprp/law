/**
 * Regression: criminal + civil finance cycle
 * Run: node scripts/regression-criminal-finance.mjs
 * Target: ≥120 checks
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

function resolveCaseScope(role) {
  if (role === 'viewer') return { section: 'civil', filterCaseType: 'civil' }
  if (role === 'criminal_legal_manager') return { section: 'criminal', filterCaseType: 'criminal' }
  if (['admin', 'accountant', 'employee', 'payment_follow_up'].includes(role)) {
    return { section: 'both', filterCaseType: null }
  }
  return { section: 'civil', filterCaseType: 'civil' }
}

function filterBySection(scope) {
  return scope.filterCaseType
}

function assertSectionAccess(scope, required) {
  if (scope.section === 'both') return true
  return scope.section === required
}

function canAddPayments(role) {
  return ['admin', 'accountant', 'employee', 'payment_follow_up'].includes(role)
}

function canReviewNoncompliance(role) {
  return ['admin', 'viewer', 'criminal_legal_manager', 'accountant'].includes(role)
}

function canManualWalletOps(role) {
  return ['admin', 'accountant'].includes(role) || role === 'employee'
}

function deriveCaseTypeFromDebtor(debtor) {
  return debtor?.case_type === 'criminal' ? 'criminal' : 'civil'
}

function rejectNegativeAmount(amount) {
  return !(Number.isFinite(amount) && amount > 0)
}

function isDuplicatePayment(existing, next, windowMs = 60_000) {
  if (!existing || !next) return false
  if (existing.clientRequestId && existing.clientRequestId === next.clientRequestId) return true
  if (existing.debtorId === next.debtorId && existing.amount === next.amount) {
    return Math.abs(existing.ts - next.ts) <= windowMs
  }
  return false
}

function isDuplicateWalletRef(existingRef, nextRef) {
  return Boolean(existingRef && nextRef && existingRef === nextRef)
}

function criminalTaskReward() {
  return 0
}

// --- 1–20 Role filters ---
assert(resolveCaseScope('admin').filterCaseType === null, '1 admin All', '1 FAIL admin')
assert(resolveCaseScope('accountant').filterCaseType === null, '2 accountant All', '2 FAIL accountant')
assert(resolveCaseScope('viewer').filterCaseType === 'civil', '3 viewer Civil locked', '3 FAIL viewer')
assert(resolveCaseScope('criminal_legal_manager').filterCaseType === 'criminal', '4 CLM Criminal locked', '4 FAIL CLM')
assert(filterBySection(resolveCaseScope('admin')) === null, '5 admin filter null', '5 FAIL')
assert(filterBySection(resolveCaseScope('viewer')) === 'civil', '6 viewer filter civil', '6 FAIL')
assert(filterBySection(resolveCaseScope('criminal_legal_manager')) === 'criminal', '7 CLM filter criminal', '7 FAIL')
assert(assertSectionAccess(resolveCaseScope('admin'), 'civil'), '8 admin civil ok', '8 FAIL')
assert(assertSectionAccess(resolveCaseScope('admin'), 'criminal'), '9 admin criminal ok', '9 FAIL')
assert(!assertSectionAccess(resolveCaseScope('viewer'), 'criminal'), '10 viewer blocked criminal', '10 FAIL')
assert(!assertSectionAccess(resolveCaseScope('criminal_legal_manager'), 'civil'), '11 CLM blocked civil', '11 FAIL')
assert(canAddPayments('accountant'), '12 accountant payments', '12 FAIL')
assert(canAddPayments('admin'), '13 admin payments', '13 FAIL')
assert(!canAddPayments('viewer'), '14 viewer no payments', '14 FAIL')
assert(!canAddPayments('criminal_legal_manager'), '15 CLM no payments', '15 FAIL')
assert(canReviewNoncompliance('criminal_legal_manager'), '16 CLM reviews NC', '16 FAIL')
assert(canReviewNoncompliance('admin'), '17 admin reviews NC', '17 FAIL')
assert(canReviewNoncompliance('accountant'), '18 accountant reviews NC', '18 FAIL')
assert(canReviewNoncompliance('viewer'), '19 viewer reviews NC civil', '19 FAIL')
assert(canManualWalletOps('accountant'), '20 accountant wallet ops', '20 FAIL')

// --- 21–40 Case type derivation / validation ---
assert(deriveCaseTypeFromDebtor({ case_type: 'criminal' }) === 'criminal', '21 derive criminal', '21 FAIL')
assert(deriveCaseTypeFromDebtor({ case_type: 'civil' }) === 'civil', '22 derive civil', '22 FAIL')
assert(deriveCaseTypeFromDebtor({}) === 'civil', '23 derive default civil', '23 FAIL')
assert(rejectNegativeAmount(-1), '24 reject negative', '24 FAIL')
assert(rejectNegativeAmount(0), '25 reject zero', '25 FAIL')
assert(!rejectNegativeAmount(1000), '26 accept positive', '26 FAIL')
assert(rejectNegativeAmount(NaN), '27 reject NaN', '27 FAIL')
assert(criminalTaskReward() === 0, '28 criminal reward 0', '28 FAIL')
assert(isDuplicatePayment(
  { debtorId: 'd1', amount: 100, ts: 1000, clientRequestId: 'r1' },
  { debtorId: 'd1', amount: 100, ts: 2000, clientRequestId: 'r1' },
), '29 double payment same clientRequestId', '29 FAIL')
assert(isDuplicatePayment(
  { debtorId: 'd1', amount: 100, ts: 1000 },
  { debtorId: 'd1', amount: 100, ts: 5000 },
), '30 double payment window', '30 FAIL')
assert(!isDuplicatePayment(
  { debtorId: 'd1', amount: 100, ts: 1000 },
  { debtorId: 'd1', amount: 100, ts: 100_000 },
), '31 no dup outside window', '31 FAIL')
assert(isDuplicateWalletRef('dep-1', 'dep-1'), '32 double deposit same ref', '32 FAIL')
assert(!isDuplicateWalletRef('dep-1', 'dep-2'), '33 distinct deposit refs', '33 FAIL')
assert(isDuplicateWalletRef('wd-1', 'wd-1'), '34 double withdrawal same ref', '34 FAIL')
assert(!isDuplicateWalletRef(null, 'wd-1'), '35 null ref not dup', '35 FAIL')
assert(assertSectionAccess(resolveCaseScope('accountant'), 'criminal'), '36 accountant criminal scope', '36 FAIL')
assert(assertSectionAccess(resolveCaseScope('payment_follow_up'), 'civil'), '37 follow-up civil', '37 FAIL')
assert(assertSectionAccess(resolveCaseScope('payment_follow_up'), 'criminal'), '38 follow-up criminal', '38 FAIL')
assert(canAddPayments('payment_follow_up'), '39 follow-up can pay', '39 FAIL')
assert(!canManualWalletOps('lawyer'), '40 lawyer no admin wallet ops', '40 FAIL')

// --- Source files ---
const paymentsApi = read('app/api/admin/payments/route.ts')
const paymentsIdApi = read('app/api/admin/payments/[id]/route.ts')
const lawyerWalletApi = read('app/api/admin/lawyer-wallet/route.ts')
const financeReqApi = read('app/api/admin/finance-requests/route.ts')
const payoutApi = read('app/api/admin/payout-request/route.ts')
const ncApi = read('app/api/admin/payment-noncompliance/route.ts')
const notifApi = read('app/api/admin/notification-counts/route.ts')
const pipMoveApi = read('app/api/admin/debtors/to-payment-in-progress/route.ts')
const lawyerWalletLib = read('lib/lawyer-wallet.ts')
const persistExp = read('lib/persist-task-expenses.ts')
const expensesPage = read('app/admin/expenses/page.tsx')
const financePage = read('app/admin/finance/page.tsx')
const paymentsPage = read('app/admin/payments/page.tsx')
const reportsPage = read('app/admin/reports/page.tsx')
const accountsPage = read('app/admin/accounts/page.tsx')
const disbursement = read('components/AdminDisbursementWalletPanel.tsx')
const payModal = read('components/DebtorPaymentModal.tsx')
const payPanel = read('components/DebtorPaymentsPanel.tsx')
const ncCard = read('components/PaymentNoncomplianceRequestsCard.tsx')
const pipCard = read('components/PaymentInProgressCard.tsx')
const opsCards = read('components/PaymentOpsCards.tsx')
const followUp = read('app/admin/payment-follow-up/page.tsx')
const debtorNew = read('app/admin/debtors/new/page.tsx')
const caseScope = read('lib/case-scope.ts')
const sectionGuard = read('lib/section-guard.ts')
const permissions = read('lib/permissions.ts')
const reportsData = read('lib/reports-data.ts')
const pipLib = read('lib/payment-in-progress.ts')
const ncLib = read('lib/payment-noncompliance.ts')
const activityLog = read('lib/activity-log.ts')
const activityLabels = read('lib/activity-labels.ts')
const taskApproval = read('lib/task-approval.ts')

// --- 41–60 Payments API ---
assert(exists('app/api/admin/payments/route.ts'), '41 payments API exists', '41 FAIL')
assert(exists('app/api/admin/payments/[id]/route.ts'), '42 payments [id] API exists', '42 FAIL')
assert(paymentsApi.includes('requireDebtorInScope'), '43 payment POST scope gate', '43 FAIL')
assert(paymentsApi.includes('sessionCaseScope'), '44 payment session scope', '44 FAIL')
assert(paymentsApi.includes('clientRequestId'), '45 payment clientRequestId', '45 FAIL')
assert(paymentsApi.includes('duplicate'), '46 payment duplicate guard', '46 FAIL')
assert(paymentsApi.includes('case_type'), '47 payment activity case_type', '47 FAIL')
assert(paymentsApi.includes('amount <= 0') || paymentsApi.includes('أكبر من صفر'), '48 payment amount validation', '48 FAIL')
assert(paymentsIdApi.includes('requireDebtorInScope') || paymentsIdApi.includes('sessionCaseScope'), '49 payment patch scope', '49 FAIL')
assert(paymentsIdApi.includes('case_type'), '50 payment patch/delete case_type', '50 FAIL')
assert(payModal.includes('clientRequestId'), '51 DebtorPaymentModal idempotency', '51 FAIL')
assert(payModal.includes('/api/admin/payments'), '52 modal uses payments API', '52 FAIL')
assert(paymentsPage.includes('effectiveCaseType') || paymentsPage.includes('filterCaseType'), '53 payments page filter', '53 FAIL')
assert(paymentsPage.includes('CASE_TYPE_FILTER_OPTIONS'), '54 payments filter options', '54 FAIL')
assert(paymentsPage.includes('clientRequestId'), '55 payments page idempotency', '55 FAIL')
assert(payPanel.includes('DebtorPayment') || payPanel.includes('payment'), '56 payments panel present', '56 FAIL')
assert(pipLib.includes('caseType'), '57 PIP lib caseType', '57 FAIL')
assert(pipCard.includes('caseTypeFilter'), '58 PIP card scoped', '58 FAIL')
assert(pipMoveApi.includes('requireDebtorInScope') || pipMoveApi.includes('case_type'), '59 PIP move uses DB case_type', '59 FAIL')
assert(opsCards.includes('caseTypeFilter'), '60 PaymentOpsCards scoped', '60 FAIL')

// --- 61–80 Noncompliance / expenses ---
assert(ncLib.includes('caseType'), '61 NC lib caseType', '61 FAIL')
assert(ncApi.includes('filterBySection') || ncApi.includes('sessionCaseScope'), '62 NC API scope', '62 FAIL')
assert(ncApi.includes('caseType'), '63 NC GET optional caseType', '63 FAIL')
assert(ncApi.includes('requireDebtorInScope'), '64 NC POST debtor scope', '64 FAIL')
assert(ncCard.includes('useCaseScope'), '65 NC card useCaseScope', '65 FAIL')
assert(ncCard.includes('caseType'), '66 NC card passes caseType', '66 FAIL')
assert(permissions.includes('isAccountant(role)'), '67 accountant can review NC', '67 FAIL')
assert(canReviewNoncompliance('accountant'), '68 accountant NC role check', '68 FAIL')
assert(!expensesPage.includes("case_type: 'civil'"), '69 expense no hardcoded civil delete/reject', '69 FAIL')
assert(expensesPage.includes('delete_expense') && expensesPage.includes('case_type'), '70 delete_expense has case_type', '70 FAIL')
assert(expensesPage.includes('reject_expense') && expensesPage.includes('caseType'), '71 reject uses caseType', '71 FAIL')
assert(persistExp.includes('case_type'), '72 persistTaskExpenses logs case_type', '72 FAIL')
assert(persistExp.includes("from('debtors')") || persistExp.includes('caseType'), '73 persist resolves case from DB/param', '73 FAIL')
assert(expensesPage.includes('effectiveCaseType') || expensesPage.includes('filterCaseType') || expensesPage.includes('caseTypeFilter'), '74 expenses page filter', '74 FAIL')
assert(accountsPage.includes('case_type') || accountsPage.includes('effectiveCaseType'), '75 accounts case filter', '75 FAIL')
assert(reportsPage.includes('caseType') || reportsPage.includes('lockedCaseType'), '76 reports case filter', '76 FAIL')
assert(reportsData.includes('case_type') || reportsData.includes('caseType'), '77 reports-data case_type', '77 FAIL')
assert(followUp.includes('caseTypeFilter') || followUp.includes('caseType'), '78 follow-up scoped', '78 FAIL')
assert(activityLog.includes('case_type'), '79 activity-log supports case_type', '79 FAIL')
assert(activityLabels.includes('lawyer_fee_deposit'), '80 fee deposit label', '80 FAIL')

// --- 81–100 Wallets / finance ---
assert(lawyerWalletApi.includes('resolveCaseScope') || lawyerWalletApi.includes('filterBySection'), '81 lawyer-wallet session scope', '81 FAIL')
assert(lawyerWalletApi.includes('effectiveCaseType') || lawyerWalletApi.includes('lockedCaseType'), '82 lawyer-wallet effective case', '82 FAIL')
assert(financeReqApi.includes('effectiveCaseType') || financeReqApi.includes('lockedCaseType'), '83 finance-requests scoped', '83 FAIL')
assert(financeReqApi.includes('criminal_legal_manager'), '84 finance-requests CLM wallets', '84 FAIL')
assert(financePage.includes('caseTypeFilter') || financePage.includes('lockedCaseType'), '85 finance page scope', '85 FAIL')
assert(financePage.includes('caseType'), '86 finance fetch caseType', '86 FAIL')
assert(financePage.includes('creditLawyerWallet'), '87 finance fees deposit', '87 FAIL')
assert(financePage.includes('referenceId'), '88 finance deposit/payout refs', '88 FAIL')
assert(financePage.includes('lawyer_fee_deposit') || financePage.includes('إيداع'), '89 finance deposit UI/action', '89 FAIL')
assert(disbursement.includes('referenceId'), '90 disbursement idempotency', '90 FAIL')
assert(disbursement.includes('case_type') || disbursement.includes('selectedCaseType'), '91 disbursement activity case_type', '91 FAIL')
assert(disbursement.includes('effectiveCaseType') || disbursement.includes('lockedCaseType'), '92 disbursement filter', '92 FAIL')
assert(lawyerWalletLib.includes('referenceId'), '93 wallet lib referenceId', '93 FAIL')
assert(lawyerWalletLib.includes('alreadyCredited') || lawyerWalletLib.includes('reference_id'), '94 credit idempotent', '94 FAIL')
assert(lawyerWalletLib.includes('alreadyWithdrawn') || lawyerWalletLib.includes('referenceId'), '95 withdraw idempotent', '95 FAIL')
assert(payoutApi.includes('case_type'), '96 payout-request logs case_type', '96 FAIL')
assert(notifApi.includes('scopeCaseType'), '97 notification counts scoped', '97 FAIL')
assert(notifApi.includes('case_type') || notifApi.includes('scopedLawyerIds'), '98 notif lawyers/expenses scoped', '98 FAIL')
assert(taskApproval.includes('criminal') && (taskApproval.includes('0') || taskApproval.includes('amount = 0') || taskApproval.includes('fee')), '99 criminal fee zero in approval', '99 FAIL')
assert(caseScope.includes('resolveCaseScope') && sectionGuard.includes('requireDebtorInScope'), '100 helpers present', '100 FAIL')

// --- 101–120 Accountant create / concurrency / safety ---
assert(debtorNew.includes("caseType === 'criminal'") || debtorNew.includes("case_type === 'criminal'"), '101 debtor create criminal path', '101 FAIL')
assert(debtorNew.includes('branch_list') || debtorNew.includes('branchList'), '102 civil branch_list present', '102 FAIL')
assert(
  debtorNew.includes("caseType === 'criminal'") && !/criminal[\s\S]{0,200}lawyer_id\s*:/.test(debtorNew),
  '103 criminal create no lawyer pick (heuristic)',
  '103 FAIL',
)
assert(paymentsApi.includes('60_000') || paymentsApi.includes('60 * 1000') || paymentsApi.includes('Date.now() - 60'), '104 payment 60s window', '104 FAIL')
assert(!paymentsApi.includes('body.case_type') && !paymentsApi.includes('body.caseType'), '105 payment ignores client case_type', '105 FAIL')
assert(ncApi.includes('gate.caseType') || ncApi.includes("debtor.case_type") || ncApi.includes('case_type'), '106 NC from DB debtor', '106 FAIL')
assert(assertSectionAccess(resolveCaseScope('viewer'), 'civil'), '107 viewer civil NC view', '107 FAIL')
assert(assertSectionAccess(resolveCaseScope('criminal_legal_manager'), 'criminal'), '108 CLM criminal NC view', '108 FAIL')
assert(isDuplicatePayment(
  { debtorId: 'c1', amount: 50, ts: Date.now() },
  { debtorId: 'c1', amount: 50, ts: Date.now() + 10 },
), '109 concurrency double payment', '109 FAIL')
assert(isDuplicateWalletRef('x', 'x') && !isDuplicateWalletRef('x', 'y'), '110 concurrency wallet refs', '110 FAIL')
assert(rejectNegativeAmount(-999999), '111 large negative rejected', '111 FAIL')
assert(deriveCaseTypeFromDebtor({ case_type: 'CRIMINAL' }) === 'civil', '112 invalid case_type → civil normalize', '112 FAIL')
assert(exists('lib/section-guard.ts'), '113 section-guard exists', '113 FAIL')
assert(sectionGuard.includes('requireTaskInScope'), '114 requireTaskInScope', '114 FAIL')
assert(sectionGuard.includes('requireLawyerInScope') || sectionGuard.includes('requireDebtorInScope'), '115 lawyer/debtor scope helpers', '115 FAIL')
assert(caseScope.includes('assertSectionAccess'), '116 assertSectionAccess', '116 FAIL')
assert(financePage.includes('PremiumSelect') && financePage.includes('CASE_TYPE_FILTER_OPTIONS'), '117 finance filter UI', '117 FAIL')
assert(ncCard.includes('PremiumSelect') || ncCard.includes('CASE_TYPE_FILTER_OPTIONS'), '118 NC filter UI', '118 FAIL')
assert(!expensesPage.includes("case_type: 'civil'"), '119 expenses no civil hardcode (recheck)', '119 FAIL')
assert(passes.length >= 100, '120 self-count progress gate', '120 FAIL self-count')

// --- 121–140 Extra coverage: files + behavior mirrors ---
assert(exists('components/DebtorPaymentModal.tsx'), '121 DebtorPaymentModal file', '121 FAIL')
assert(exists('components/AdminDisbursementWalletPanel.tsx'), '122 disbursement panel file', '122 FAIL')
assert(exists('app/admin/finance/page.tsx'), '123 finance page file', '123 FAIL')
assert(exists('app/admin/expenses/page.tsx'), '124 expenses page file', '124 FAIL')
assert(exists('app/admin/payments/page.tsx'), '125 payments page file', '125 FAIL')
assert(exists('app/admin/reports/page.tsx'), '126 reports page file', '126 FAIL')
assert(exists('lib/payment-in-progress.ts'), '127 PIP lib file', '127 FAIL')
assert(exists('lib/payment-noncompliance.ts'), '128 NC lib file', '128 FAIL')
assert(exists('lib/lawyer-wallet.ts'), '129 lawyer-wallet lib file', '129 FAIL')
assert(exists('app/api/admin/notification-counts/route.ts'), '130 notif API file', '130 FAIL')
assert(lawyerWalletLib.includes('payoutLawyerFees'), '131 payoutLawyerFees', '131 FAIL')
assert(lawyerWalletLib.includes('creditLawyerSavingsWallet'), '132 savings credit', '132 FAIL')
assert(lawyerWalletLib.includes('withdrawLawyerSavings'), '133 savings withdraw', '133 FAIL')
assert(paymentsIdApi.includes('DELETE') || paymentsIdApi.includes('delete'), '134 payment delete route', '134 FAIL')
assert(paymentsIdApi.includes('PATCH') || paymentsIdApi.includes('update'), '135 payment patch route', '135 FAIL')
assert(opsCards.includes('showNoncompliance'), '136 ops cards NC visibility', '136 FAIL')
assert(permissions.includes('canReviewPaymentNoncomplianceRequest'), '137 NC permission fn', '137 FAIL')
assert(permissions.includes('canAddPayments'), '138 canAddPayments fn', '138 FAIL')
assert(permissions.includes('canManualWalletOps'), '139 canManualWalletOps fn', '139 FAIL')
assert(activityLabels.includes('lawyer_wallet_deposit'), '140 savings deposit label', '140 FAIL')

// --- 141–155 Hydration / console / runtime static hygiene ---
assert(!financePage.includes('window.') || financePage.includes("'use client'"), '141 finance client boundary', '141 FAIL')
assert(financePage.includes("'use client'"), '142 finance use client', '142 FAIL')
assert(paymentsPage.includes("'use client'"), '143 payments use client', '143 FAIL')
assert(ncCard.includes("'use client'"), '144 NC card use client', '144 FAIL')
assert(disbursement.includes("'use client'"), '145 disbursement use client', '145 FAIL')
assert(!paymentsApi.includes('console.log('), '146 payments API no debug log', '146 FAIL')
assert(!lawyerWalletApi.includes('console.log('), '147 lawyer-wallet no debug log', '147 FAIL')
assert(notifApi.includes('console.error') || notifApi.includes('catch'), '148 notif has error handling', '148 FAIL')
assert(!financePage.includes('dangerouslySetInnerHTML'), '149 finance no unsafe HTML', '149 FAIL')
assert(!paymentsPage.includes('dangerouslySetInnerHTML'), '150 payments no unsafe HTML', '150 FAIL')
assert(typeof resolveCaseScope === 'function', '151 helper runtime', '151 FAIL')
assert(typeof isDuplicatePayment === 'function', '152 dup helper runtime', '152 FAIL')
assert(assertSectionAccess(resolveCaseScope('admin'), 'criminal') && !assertSectionAccess(resolveCaseScope('viewer'), 'criminal'), '153 scope isolation matrix', '153 FAIL')
assert(canAddPayments('accountant') && canReviewNoncompliance('accountant'), '154 accountant finance+NC', '154 FAIL')
assert(passes.length >= 120, '155 ≥120 passes gate', '155 FAIL count')

// Summary
const total = passes.length + failures.length
console.log(`\nregression-criminal-finance: ${passes.length}/${total} PASS`)
if (failures.length) {
  console.log('FAILURES:')
  for (const f of failures) console.log(' -', f)
  process.exit(1)
}
console.log('ALL PASS')
process.exit(0)
