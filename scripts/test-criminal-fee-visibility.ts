/**
 * Unit-style checks for criminal fee visibility (no DB / no network).
 * Run: npx tsx scripts/test-criminal-fee-visibility.ts
 */
import {
  canSeeCriminalTaskFees,
  visibleTaskFeeAmount,
  shouldCountFeesWalletTxForViewer,
} from '../lib/visible-task-fee'
import { achievementFee, type AchievementTask } from '../lib/achievement-report'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`OK: ${msg}`)
}

const fee = 150_000

assert(canSeeCriminalTaskFees('admin') === true, 'admin sees criminal fees')
assert(canSeeCriminalTaskFees('lawyer') === false, 'lawyer does not see criminal fees')
assert(canSeeCriminalTaskFees('criminal_legal_manager') === false, 'CLM does not see criminal fees')
assert(canSeeCriminalTaskFees('legal_manager') === false, 'civil LM does not see criminal fees')
assert(canSeeCriminalTaskFees('accountant') === false, 'accountant does not see criminal fees')

assert(visibleTaskFeeAmount(fee, 'civil', 'lawyer') === fee, 'civil fee visible to lawyer')
assert(visibleTaskFeeAmount(fee, 'civil', 'admin') === fee, 'civil fee visible to admin')
assert(visibleTaskFeeAmount(fee, 'criminal', 'admin') === fee, 'criminal fee visible to admin')
assert(visibleTaskFeeAmount(fee, 'criminal', 'lawyer') === 0, 'criminal fee zero for lawyer')
assert(visibleTaskFeeAmount(fee, 'criminal', 'criminal_legal_manager') === 0, 'criminal fee zero for CLM')

const criminalTaskIds = new Set(['t-crim'])
assert(
  shouldCountFeesWalletTxForViewer('lawyer', { type: 'approved_task_payment', reference_id: 't-crim' }, criminalTaskIds) === false,
  'lawyer skips criminal approved_task_payment',
)
assert(
  shouldCountFeesWalletTxForViewer('admin', { type: 'approved_task_payment', reference_id: 't-crim' }, criminalTaskIds) === true,
  'admin counts criminal approved_task_payment',
)
assert(
  shouldCountFeesWalletTxForViewer('lawyer', { type: 'fee_payout', reference_id: null }, criminalTaskIds) === true,
  'lawyer still counts fee_payout rows',
)
assert(
  shouldCountFeesWalletTxForViewer('lawyer', { type: 'approved_task_payment', reference_id: 't-civil' }, criminalTaskIds) === true,
  'lawyer counts civil approved_task_payment',
)

const civilAch: AchievementTask = {
  id: '1',
  task_type: null,
  task_status: 'approved',
  assigned_to: 'l1',
  debtor_id: 'd1',
  completed_at: '2026-01-01',
  created_at: '2026-01-01',
  task_definition_id: null,
  reward_amount: fee,
  case_type: 'civil',
}
const crimAch: AchievementTask = { ...civilAch, id: '2', case_type: 'criminal' }

assert(achievementFee(civilAch, 'lawyer') === fee, 'achievementFee civil for lawyer')
assert(achievementFee(crimAch, 'lawyer') === 0, 'achievementFee criminal zero for lawyer')
assert(achievementFee(crimAch, 'admin') === fee, 'achievementFee criminal real for admin')

console.log('\nAll criminal fee visibility checks passed.')
