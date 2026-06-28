import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { approveTaskCompletion, creditTaskFeeOnApproval } from '../lib/task-approval'
import { fetchLawyerWalletBalance } from '../lib/lawyer-wallet'

function loadEnv() {
  let raw = readFileSync('.env.local', 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
}

async function main() {
  loadEnv()
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const taskId = process.argv[2]
  if (!taskId) {
    console.error('Usage: npx tsx scripts/test-task-fee-approval.ts <taskId>')
    process.exit(1)
  }

  const { data: task } = await supabase
    .from('tasks')
    .select('id, assigned_to, debtor_id, reward_amount, task_status, task_definitions(fee_amount, label)')
    .eq('id', taskId)
    .single()

  if (!task?.assigned_to || !task.debtor_id) {
    console.error('Task not found or missing lawyer/debtor')
    process.exit(1)
  }

  const def = Array.isArray(task.task_definitions) ? task.task_definitions[0] : task.task_definitions
  const expected = Number(task.reward_amount ?? 0) || Number(def?.fee_amount ?? 0)
  const lawyerId = task.assigned_to as string
  const debtorId = task.debtor_id as string

  const { data: debtorBefore } = await supabase
    .from('debtors')
    .select('lawyer_fees, required_amount')
    .eq('id', debtorId)
    .single()

  const walletBefore = await fetchLawyerWalletBalance(supabase, lawyerId, 'fees')
  console.log('Status:', task.task_status, '| Expected fee:', expected)
  console.log('Debtor lawyer_fees before:', debtorBefore?.lawyer_fees, '| required:', debtorBefore?.required_amount)
  console.log('Wallet before:', walletBefore)

  let walletDeltaExpected = 0

  if (!['approved', 'completed'].includes(task.task_status)) {
    const approve = await approveTaskCompletion(supabase, taskId, lawyerId)
    console.log('Approve:', approve)
    if (!approve.ok) process.exit(1)
    walletDeltaExpected = approve.feeAmount
    if (approve.feeAmount !== expected && expected > 0) {
      console.error(`FAIL: feeAmount ${approve.feeAmount} !== expected ${expected}`)
      process.exit(1)
    }
  } else {
    const sync = await creditTaskFeeOnApproval(supabase, taskId, lawyerId)
    console.log('Sync existing approved task:', sync)
    if (!sync.ok) process.exit(1)
    walletDeltaExpected = sync.alreadyCredited ? 0 : sync.amount
  }

  const repeat = await creditTaskFeeOnApproval(supabase, taskId, lawyerId)
  console.log('Repeat credit (idempotent):', repeat)
  if (!repeat.ok || (!repeat.alreadyCredited && repeat.amount > 0)) {
    console.error('FAIL: repeat credit should be idempotent')
    process.exit(1)
  }

  const { data: debtorAfter } = await supabase
    .from('debtors')
    .select('lawyer_fees, required_amount')
    .eq('id', debtorId)
    .single()

  const walletAfter = await fetchLawyerWalletBalance(supabase, lawyerId, 'fees')
  const lawyerFeesDelta = Number(debtorAfter?.lawyer_fees ?? 0) - Number(debtorBefore?.lawyer_fees ?? 0)
  const requiredDelta = Number(debtorAfter?.required_amount ?? 0) - Number(debtorBefore?.required_amount ?? 0)
  const walletDelta = walletAfter - walletBefore

  console.log('Debtor lawyer_fees after:', debtorAfter?.lawyer_fees, '(delta', lawyerFeesDelta, ')')
  console.log('Required after:', debtorAfter?.required_amount, '(delta', requiredDelta, ')')
  console.log('Wallet after:', walletAfter, '(delta', walletDelta, ')')

  if (expected > 0) {
    const feesDeltaExpected = walletDeltaExpected > 0 ? expected : (Number(debtorAfter?.lawyer_fees ?? 0) - Number(debtorBefore?.lawyer_fees ?? 0))
    if (feesDeltaExpected > 0 && lawyerFeesDelta !== feesDeltaExpected) {
      console.error(`FAIL: lawyer_fees delta ${lawyerFeesDelta} !== ${feesDeltaExpected}`)
      process.exit(1)
    }
    if (walletDeltaExpected > 0 && walletDelta !== walletDeltaExpected) {
      console.error(`FAIL: wallet delta ${walletDelta} !== ${walletDeltaExpected}`)
      process.exit(1)
    }
  }

  const { data: tx } = await supabase
    .from('lawyer_wallet_transactions')
    .select('id, amount, reference_id, notes')
    .eq('reference_id', taskId)
    .eq('wallet', 'fees')
    .gt('amount', 0)

  console.log('Wallet transactions for task:', tx?.length ?? 0)
  if (expected > 0 && (tx?.length ?? 0) !== 1) {
    console.error('FAIL: expected exactly one wallet transaction')
    process.exit(1)
  }

  console.log('PASS')
}

main().catch(e => { console.error(e); process.exit(1) })
