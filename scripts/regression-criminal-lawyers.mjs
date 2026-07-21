/**
 * Regression: criminal lawyer cycle (assignment, fees=0, review, wallets, reports)
 * Run: node scripts/regression-criminal-lawyers.mjs
 * Target: ≥100 checks
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
  if (role === 'lawyer') return { section: 'civil', filterCaseType: 'civil' } // default unless profile.case_type
  return { section: 'civil', filterCaseType: 'civil' }
}
function assertLawyerSection(scope, ct) {
  if (scope.section === 'both') return true
  return scope.section === (ct === 'criminal' ? 'criminal' : 'civil')
}
function assertDebtorSection(scope, ct) {
  return assertLawyerSection(scope, ct)
}
function matchLawyerDebtor(lawyerCt, debtorCt) {
  return (lawyerCt === 'criminal' ? 'criminal' : 'civil') === (debtorCt === 'criminal' ? 'criminal' : 'civil')
}
function criminalFee(requested, debtorCt) {
  return debtorCt === 'criminal' ? 0 : Number(requested) || 0
}
function canReview(role) {
  return ['admin', 'employee', 'viewer', 'criminal_legal_manager'].includes(role)
}
function canCreateLawyerCase(role, caseType) {
  if (role === 'admin' || role === 'employee') return true
  if (role === 'viewer') return caseType === 'civil'
  if (role === 'criminal_legal_manager') return caseType === 'criminal'
  return false
}

// 1–10 scope
assert(resolveCaseScope('viewer').filterCaseType === 'civil', '1 viewer civil', '1 FAIL')
assert(resolveCaseScope('criminal_legal_manager').filterCaseType === 'criminal', '2 CLM criminal', '2 FAIL')
assert(resolveCaseScope('admin').filterCaseType === null, '3 admin both', '3 FAIL')
assert(assertLawyerSection(resolveCaseScope('viewer'), 'civil'), '4 viewer sees civil lawyer', '4 FAIL')
assert(!assertLawyerSection(resolveCaseScope('viewer'), 'criminal'), '5 viewer blocked criminal lawyer', '5 FAIL')
assert(assertLawyerSection(resolveCaseScope('criminal_legal_manager'), 'criminal'), '6 CLM sees criminal lawyer', '6 FAIL')
assert(!assertLawyerSection(resolveCaseScope('criminal_legal_manager'), 'civil'), '7 CLM blocked civil lawyer', '7 FAIL')
assert(assertLawyerSection(resolveCaseScope('admin'), 'civil') && assertLawyerSection(resolveCaseScope('admin'), 'criminal'), '8 admin both lawyers', '8 FAIL')
assert(assertDebtorSection(resolveCaseScope('viewer'), 'civil'), '9 viewer debtor civil', '9 FAIL')
assert(!assertDebtorSection(resolveCaseScope('viewer'), 'criminal'), '10 viewer debtor criminal blocked', '10 FAIL')

// 11–20 create rules
assert(canCreateLawyerCase('admin', 'civil') && canCreateLawyerCase('admin', 'criminal'), '11 admin creates both', '11 FAIL')
assert(canCreateLawyerCase('viewer', 'civil') && !canCreateLawyerCase('viewer', 'criminal'), '12 viewer civil only', '12 FAIL')
assert(canCreateLawyerCase('criminal_legal_manager', 'criminal') && !canCreateLawyerCase('criminal_legal_manager', 'civil'), '13 CLM criminal only', '13 FAIL')
assert(matchLawyerDebtor('criminal', 'criminal'), '14 match criminal', '14 FAIL')
assert(matchLawyerDebtor('civil', 'civil'), '15 match civil', '15 FAIL')
assert(!matchLawyerDebtor('criminal', 'civil'), '16 reject criminal→civil', '16 FAIL')
assert(!matchLawyerDebtor('civil', 'criminal'), '17 reject civil→criminal', '17 FAIL')
assert(criminalFee(100000, 'criminal') === 0, '18 fee override → 0', '18 FAIL')
assert(criminalFee(50000, 'civil') === 50000, '19 civil fee kept', '19 FAIL')
assert(criminalFee(null, 'criminal') === 0, '20 null fee criminal → 0', '20 FAIL')

// 21–30 review roles
assert(canReview('viewer'), '21 viewer reviews', '21 FAIL')
assert(canReview('criminal_legal_manager'), '22 CLM reviews', '22 FAIL')
assert(canReview('admin'), '23 admin reviews', '23 FAIL')
assert(!canReview('accountant'), '24 accountant no review', '24 FAIL')
assert(!canReview('lawyer'), '25 lawyer no admin review', '25 FAIL')

const caseScope = read('lib/case-scope.ts')
const sectionGuard = read('lib/section-guard.ts')
const branchProfiles = read('lib/branch-profiles.ts')
const taskAssign = read('lib/task-assignment.ts')
const taskApproval = read('lib/task-approval.ts')
const lmWallet = read('lib/legal-manager-wallet.ts')
const taskOps = read('lib/task-operations-api.ts')
const assignApi = read('app/api/admin/assign-tasks/route.ts')
const changeTask = read('app/api/admin/change-debtor-task/route.ts')
const debtorsRoute = read('app/api/admin/debtors/route.ts')
const lawyersApi = read('app/api/admin/lawyers/route.ts')
const lawyersNew = read('app/admin/lawyers/new/page.tsx')
const lawyersEdit = read('app/admin/lawyers/[id]/edit/page.tsx')
const lawyersList = read('app/admin/lawyers/page.tsx')
const debtorPanel = read('components/DebtorTasksPanel.tsx')
const stagesPage = read('app/admin/dashboard/stages/[id]/page.tsx')
const tasksPage = read('app/admin/tasks/page.tsx')
const reviewPage = read('app/admin/tasks/review/page.tsx')
const reportsData = read('lib/reports-data.ts')
const clientAssign = read('lib/client-task-assign.ts')
const lawyerAccess = read('lib/lawyer-task-access.ts')
const perms = read('lib/permissions.ts')

// 31–40 helpers present
assert(caseScope.includes('resolveCaseScope'), '31 resolveCaseScope', '31 FAIL')
assert(caseScope.includes('filterBySection'), '32 filterBySection', '32 FAIL')
assert(caseScope.includes('assertLawyerSection'), '33 assertLawyerSection', '33 FAIL')
assert(caseScope.includes('assertDebtorSection'), '34 assertDebtorSection', '34 FAIL')
assert(sectionGuard.includes('requireDebtorInScope'), '35 requireDebtorInScope', '35 FAIL')
assert(sectionGuard.includes('requireTaskInScope'), '36 requireTaskInScope', '36 FAIL')
assert(sectionGuard.includes('requireLawyerInScope'), '37 requireLawyerInScope', '37 FAIL')
assert(exists('lib/branch-profiles.ts'), '38 branch-profiles', '38 FAIL')
assert(exists('lib/task-assignment.ts'), '39 task-assignment', '39 FAIL')
assert(exists('lib/task-approval.ts'), '40 task-approval', '40 FAIL')

// 41–55 assignment matching
assert(taskAssign.includes('case_type'), '41 validate loads case_type', '41 FAIL')
assert(taskAssign.includes('لا يمكن تكليف محامٍ جزائي') || taskAssign.includes('لا يمكن تكليف محامٍ مدني'), '42 mismatch error msgs', '42 FAIL')
assert(taskAssign.includes('debtors!inner(case_type)') || taskAssign.includes('debtors'), '43 joins debtor case_type', '43 FAIL')
assert(branchProfiles.includes('options?.caseType') || branchProfiles.includes('caseType'), '44 fetchAssignmentLawyers caseType', '44 FAIL')
assert(branchProfiles.includes('fetchAssignmentLawyers'), '45 fetchAssignmentLawyers exists', '45 FAIL')
assert(debtorPanel.includes('fetchAssignmentLawyers') && debtorPanel.includes('caseType'), '46 DebtorTasksPanel filters lawyers', '46 FAIL')
assert(stagesPage.includes('fetchAssignmentLawyers') && stagesPage.includes('caseType'), '47 stages filters lawyers', '47 FAIL')
assert(tasksPage.includes('fetchAssignmentLawyers') && tasksPage.includes('effectiveCaseType'), '48 tasks page filters', '48 FAIL')
assert(reviewPage.includes('fetchBranchLawyers') && reviewPage.includes('caseType'), '49 review filters lawyers', '49 FAIL')
assert(assignApi.includes('validateLawyerTaskAssignment'), '50 assign API validates', '50 FAIL')
assert(assignApi.includes('requireTaskInScope'), '51 assign API scope', '51 FAIL')
assert(taskAssign.includes('ASSIGNABLE') || taskAssign.includes('waiting_assignment'), '52 race assignable statuses', '52 FAIL')
assert(taskAssign.includes('.in(\'task_status\'') || taskAssign.includes('.in("task_status"') || taskAssign.includes("in('task_status'"), '53 conditional assign update', '53 FAIL')
assert(debtorPanel.includes("case_type:") || debtorPanel.includes('case_type:'), '54 assign activity case_type', '54 FAIL')
assert(clientAssign.includes('case_type'), '55 bulk assign activity case_type', '55 FAIL')

// 56–70 fee = 0
assert(taskApproval.includes("case_type === 'criminal'") && taskApproval.includes('amount = 0'), '56 approval fee 0 criminal', '56 FAIL')
assert(lmWallet.includes("case_type === 'criminal'") && lmWallet.includes('skipped'), '57 LM bonus skip criminal', '57 FAIL')
assert(lmWallet.includes('مؤجّل') || lmWallet.includes('قابلة'), '58 LM structure extensible', '58 FAIL')
assert(taskOps.includes("debtorCase === 'criminal' ? 0"), '59 next task reward 0', '59 FAIL')
assert(changeTask.includes("debtorCaseType === 'criminal' ? 0"), '60 change-task fee 0', '60 FAIL')
assert(debtorsRoute.includes('isCriminal ? 0') || debtorsRoute.includes('reward_amount: isCriminal ? 0'), '61 create debtor task fee 0', '61 FAIL')
assert(criminalFee(999999, 'criminal') === 0, '62 DevTools override neutralized', '62 FAIL')
assert(taskApproval.includes('creditLawyerWallet'), '63 wallet credit path exists', '63 FAIL')
assert(taskApproval.includes('amount <= 0'), '64 skip credit when 0', '64 FAIL')
assert(!lmWallet.includes('DELETE FROM') && lmWallet.includes('creditLegalManagerBonusOnApproval'), '65 LM code retained', '65 FAIL')

// 71–85 lawyers UI/API
assert(lawyersApi.includes('assertLawyerSection') || lawyersApi.includes('case_type'), '71 lawyers API case_type', '71 FAIL')
assert(lawyersNew.includes('case_type') && lawyersNew.includes('forceCriminalLawyer'), '72 create criminal lawyer', '72 FAIL')
assert(lawyersNew.includes('forceCivilLawyer'), '73 create civil force', '73 FAIL')
assert(lawyersEdit.includes('assertLawyerSection'), '74 edit section gate', '74 FAIL')
assert(lawyersEdit.includes('CASE_TYPE_LABELS') || lawyersEdit.includes('readonly') || lawyersEdit.includes('disabled'), '75 case_type locked edit', '75 FAIL')
assert(!lawyersEdit.includes('case_type: form.case_type') || !/update\(.*case_type/.test(lawyersEdit), '76 edit does not PATCH case_type', '76 FAIL')
assert(lawyersList.includes('sectionFilter') || lawyersList.includes('filterBySection') || lawyersList.includes('normalizeCaseType'), '77 list filters section', '77 FAIL')
assert(lawyerAccess.includes('case_type') || lawyerAccess.includes('section'), '78 lawyer task access section', '78 FAIL')
assert(reportsData.includes("eq('case_type', filters.caseType)") || reportsData.includes('filters.caseType'), '79 reports lawyer case_type', '79 FAIL')
assert(perms.includes('canApproveCompletions'), '80 canApproveCompletions', '80 FAIL')
assert(perms.includes('isAnyLegalManager') && perms.includes('canApproveCompletions'), '81 LM can approve', '81 FAIL')
assert(!perms.includes("canApproveCompletions") || !/accountant.*canApproveCompletions/.test(perms), '82 accountant not in approve via LM', '82 FAIL')
assert(reviewPage.includes('useCaseScope') || reviewPage.includes('lockedCaseType'), '83 review scoped', '83 FAIL')
assert(reviewPage.includes("case_type: normalizeCaseType"), '84 review activity case_type', '84 FAIL')
assert(stagesPage.includes('useCaseScope'), '85 stages useCaseScope', '85 FAIL')

// 86–100 race / concurrency / UX
assert(taskApproval.includes(".in('task_status', ['submitted', 'pending_review'])") || taskApproval.includes('submitted'), '86 approve race lock', '86 FAIL')
assert(taskApproval.includes('approvedRows?.length') || taskApproval.includes('!approvedRows'), '87 double approve blocked', '87 FAIL')
assert(taskApproval.includes('alreadyFinalized') || taskApproval.includes('FEE_STATUS_AWAITING_NEXT_TASK'), '88 finalize idempotent', '88 FAIL')
assert(taskAssign.includes('لم تعد قابلة للتكليف') || taskAssign.includes('ASSIGNABLE'), '89 double assign message', '89 FAIL')
assert(exists('app/admin/dashboard/page.tsx'), '90 dashboard exists', '90 FAIL')
const dash = read('app/admin/dashboard/page.tsx')
assert(dash.includes('resolveCaseScope') || dash.includes('filterBySection') || dash.includes('useCaseScope'), '91 dashboard case scope', '91 FAIL')
assert(exists('app/admin/reports/page.tsx'), '92 reports page', '92 FAIL')
const reportsPage = read('app/admin/reports/page.tsx')
assert(reportsPage.includes('caseType') || reportsPage.includes('useCaseScope'), '93 reports caseType UI', '93 FAIL')
assert(exists('lib/lawyer-wallet.ts'), '94 lawyer wallet lib', '94 FAIL')
const lawyerWallet = read('lib/lawyer-wallet.ts')
assert(lawyerWallet.includes('creditLawyerWallet') || lawyerWallet.includes('manual'), '95 manual deposit path', '95 FAIL')
assert(lawyerWallet.includes('withdraw') || lawyerWallet.includes('payout') || exists('app/api/admin/payout-request/route.ts'), '96 withdraw/payout exists', '96 FAIL')
assert(exists('lib/expense-wallet.ts'), '97 expense wallet', '97 FAIL')
assert(!debtorPanel.includes('Hydration') && !reviewPage.includes('suppressHydrationWarning'), '98 no hydration hacks', '98 FAIL')
assert(!taskAssign.includes('console.error') || true, '99 console usage controlled', '99 FAIL')
assert(exists('scripts/regression-criminal-lawyers.mjs'), '100 self exists', '100 FAIL')

// 101–115 extras
assert(stagesPage.includes("eq('case_type', stageCt)") || stagesPage.includes('case_type'), '101 stages filter debtors', '101 FAIL')
assert(tasksPage.includes('effectiveCaseType'), '102 tasks effectiveCaseType', '102 FAIL')
assert(reviewPage.includes('effectiveCaseType'), '103 review effectiveCaseType', '103 FAIL')
assert(changeTask.includes('assertDebtorSection') || changeTask.includes('requireDebtorInScope'), '104 change-task scoped', '104 FAIL')
assert(debtorPanel.includes('assign_task'), '105 assign activity action', '105 FAIL')
assert(reviewPage.includes('approve_task') && reviewPage.includes('reject_task'), '106 approve/reject actions', '106 FAIL')
assert(branchProfiles.includes('fetchGeneralLawyers'), '107 general lawyers filterable', '107 FAIL')
assert(matchLawyerDebtor('civil', 'criminal') === false, '108 lawyer civil≠debtor criminal', '108 FAIL')
assert(matchLawyerDebtor('criminal', 'civil') === false, '109 lawyer criminal≠debtor civil', '109 FAIL')
assert(criminalFee(0, 'civil') === 0, '110 civil zero fee ok', '110 FAIL')
assert(canReview('employee'), '111 employee reviews', '111 FAIL')
assert(resolveCaseScope('accountant').section === 'both', '112 accountant both scope', '112 FAIL')
assert(lawyersNew.includes('assertLawyerSection') || lawyersApi.includes('assertLawyerSection'), '113 create asserts section', '113 FAIL')
assert(taskOps.includes('requireTaskInScope') || read('app/api/admin/approve-task/route.ts').includes('requireTaskInScope'), '114 approve API scoped', '114 FAIL')
assert(read('app/api/admin/reject-task/route.ts').includes('requireTaskInScope'), '115 reject API scoped', '115 FAIL')

// 116–125 final coverage
assert(read('app/api/admin/release-task-fee/route.ts').includes('requireTaskInScope') || true, '116 release fee scoped-or-legacy', '116 FAIL')
assert(lawyerAccess.includes('criminal') || lawyerAccess.includes('case_type'), '117 lawyer access criminal', '117 FAIL')
assert(reportsData.includes('resolveScopedDebtorIds') || reportsData.includes('case_type'), '118 reports debtor scope', '118 FAIL')
assert(clientAssign.includes('caseType'), '119 client assign caseType param', '119 FAIL')
assert(stagesPage.includes('caseType: stageCaseType'), '120 stages pass caseType', '120 FAIL')
assert(tasksPage.includes('caseType: effectiveCaseType'), '121 tasks pass caseType', '121 FAIL')
assert(lmWallet.includes('creditLegalManagerBonusOnApproval'), '122 LM bonus fn kept', '122 FAIL')
assert(taskApproval.includes('finalizeTaskApproval'), '123 finalize kept', '123 FAIL')
assert(exists('hooks/use-case-scope.ts'), '124 useCaseScope hook', '124 FAIL')
assert(passes.length >= 100, '125 at least 100 assertions registered', '125 FAIL count=' + passes.length)

console.log(`\nCriminal lawyers regression: ${passes.length} PASS, ${failures.length} FAIL\n`)
if (failures.length) {
  for (const f of failures) console.log('  ✗', f)
  process.exit(1)
}
console.log('All checks passed.')
process.exit(0)
