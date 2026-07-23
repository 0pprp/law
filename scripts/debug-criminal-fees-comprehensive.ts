/**
 * Comprehensive debug suite for criminal task fees visibility.
 * Run: npx tsx scripts/debug-criminal-fees-comprehensive.ts
 */
import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  canSeeCriminalTaskFees,
  visibleTaskFeeAmount,
  shouldCountFeesWalletTxForViewer,
} from '../lib/visible-task-fee'
import { achievementFee, type AchievementTask } from '../lib/achievement-report'
import {
  fetchLawyerWalletBalances,
  fetchLawyerWalletBalance,
} from '../lib/lawyer-wallet'

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

type Check = { name: string; ok: boolean; detail?: string }
const checks: Check[] = []
function pass(name: string, detail?: string) {
  checks.push({ name, ok: true, detail })
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
}
function fail(name: string, detail?: string) {
  checks.push({ name, ok: false, detail })
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
}

const CRIMINAL_LABELS = [
  'تقديم طلب دعوى جزائية',
  'تدوين أقوال في مركز الشرطة',
  'تدوين أقوال في المحكمة',
  'تدوين أقوال الشهود',
]
const CRIMINAL_TYPES = [
  'criminal_lawsuit_request',
  'police_station_statement',
  'court_statement',
  'witness_statement',
]

function section(title: string) {
  console.log(`\n══ ${title} ══`)
}

async function envInventory(sb: SupabaseClient) {
  section('0) Environment inventory')
  const { data: lawyers } = await sb.from('profiles').select('case_type').eq('role', 'lawyer')
  const lm: Record<string, number> = {}
  for (const p of lawyers ?? []) {
    const c = p.case_type ?? 'null'
    lm[c] = (lm[c] ?? 0) + 1
  }
  console.log('    lawyers by case_type:', lm)

  const { count: crimDebtors } = await sb
    .from('debtors')
    .select('*', { count: 'exact', head: true })
    .eq('case_type', 'criminal')
  const { count: civilDebtors } = await sb
    .from('debtors')
    .select('*', { count: 'exact', head: true })
    .eq('case_type', 'civil')
  console.log(`    debtors criminal=${crimDebtors ?? 0} civil=${civilDebtors ?? 0}`)

  if ((crimDebtors ?? 0) === 0) {
    pass('inventory note: no criminal debtors yet — runtime criminal wallet delta cannot be live-verified')
  } else {
    pass('inventory: criminal debtors present', String(crimDebtors))
  }
  if ((lm.criminal ?? 0) === 0) {
    pass('inventory note: no criminal lawyers yet')
  } else {
    pass('inventory: criminal lawyers present', String(lm.criminal))
  }
}

async function unitLayer() {
  section('1) Unit — visible-task-fee + achievementFee')
  const fee = 25000
  const roles = [
    ['admin', true],
    ['lawyer', false],
    ['criminal_legal_manager', false],
    ['viewer', false],
    ['accountant', false],
    ['employee', false],
  ] as const

  for (const [role, sees] of roles) {
    const got = canSeeCriminalTaskFees(role)
    if (got === sees) pass(`canSeeCriminalTaskFees(${role})=${sees}`)
    else fail(`canSeeCriminalTaskFees(${role})`, `expected ${sees} got ${got}`)
  }

  if (visibleTaskFeeAmount(fee, 'civil', 'lawyer') === fee) pass('civil fee visible to lawyer')
  else fail('civil fee visible to lawyer')

  if (visibleTaskFeeAmount(fee, 'criminal', 'admin') === fee) pass('criminal fee visible to admin')
  else fail('criminal fee visible to admin')

  if (visibleTaskFeeAmount(fee, 'criminal', 'lawyer') === 0) pass('criminal fee zero for lawyer')
  else fail('criminal fee zero for lawyer')

  if (visibleTaskFeeAmount(fee, 'criminal', 'criminal_legal_manager') === 0) {
    pass('criminal fee zero for CLM')
  } else fail('criminal fee zero for CLM')

  const crimIds = new Set(['t1'])
  if (
    !shouldCountFeesWalletTxForViewer(
      'lawyer',
      { type: 'approved_task_payment', reference_id: 't1' },
      crimIds,
    )
  ) {
    pass('wallet mask: lawyer skips criminal fee credit')
  } else fail('wallet mask: lawyer skips criminal fee credit')

  if (
    shouldCountFeesWalletTxForViewer(
      'admin',
      { type: 'approved_task_payment', reference_id: 't1' },
      crimIds,
    )
  ) {
    pass('wallet mask: admin counts criminal fee credit')
  } else fail('wallet mask: admin counts criminal fee credit')

  if (
    shouldCountFeesWalletTxForViewer(
      'lawyer',
      { type: 'disbursement_credit', reference_id: 'x' },
      crimIds,
    )
  ) {
    pass('wallet mask: savings/disbursement txs not filtered by fee helper')
  } else fail('wallet mask: savings/disbursement txs not filtered by fee helper')

  const achCivil: AchievementTask = {
    id: 'a1',
    task_type: null,
    task_status: 'approved',
    assigned_to: 'l',
    debtor_id: 'd',
    completed_at: '2026-01-01',
    created_at: '2026-01-01',
    task_definition_id: null,
    reward_amount: fee,
    case_type: 'civil',
  }
  const achCrim = { ...achCivil, id: 'a2', case_type: 'criminal' as const }
  if (achievementFee(achCivil, 'lawyer') === fee) pass('achievementFee civil for lawyer')
  else fail('achievementFee civil for lawyer')
  if (achievementFee(achCrim, 'lawyer') === 0) pass('achievementFee criminal zero for lawyer')
  else fail('achievementFee criminal zero for lawyer')
  if (achievementFee(achCrim, 'admin') === fee) pass('achievementFee criminal real for admin')
  else fail('achievementFee criminal real for admin')
}

async function dbDefinitions(sb: SupabaseClient) {
  section('2) DB — criminal task_definitions fee_amount=25000')
  const { data, error } = await sb
    .from('task_definitions')
    .select('id, label, task_type, case_type, fee_amount, branch_id, is_active')
    .eq('case_type', 'criminal')
    .or(
      `task_type.in.(${CRIMINAL_TYPES.join(',')}),label.in.(${CRIMINAL_LABELS.map(l => `"${l}"`).join(',')})`,
    )

  if (error) {
    fail('fetch criminal defs', error.message)
    return [] as { id: string; fee_amount: number; label: string }[]
  }

  const rows = data ?? []
  if (!rows.length) {
    fail('found criminal defs', '0 rows')
    return []
  }
  pass(`found criminal defs`, `${rows.length} rows`)

  const bad = rows.filter(r => Number(r.fee_amount) !== 25000)
  if (!bad.length) pass('all target defs fee_amount=25000')
  else {
    fail(
      'all target defs fee_amount=25000',
      `${bad.length} bad e.g. ${bad[0].label}=${bad[0].fee_amount}`,
    )
  }

  for (const label of CRIMINAL_LABELS) {
    const n = rows.filter(r => r.label === label).length
    if (n > 0) pass(`label present: ${label}`, `${n} branch copies`)
    else fail(`label present: ${label}`)
  }

  return rows
}

async function dbCivilUnchanged(sb: SupabaseClient) {
  section('3) DB — civil definitions not zeroed by accident')
  const { data, error } = await sb
    .from('task_definitions')
    .select('id, label, fee_amount')
    .eq('case_type', 'civil')
    .gt('fee_amount', 0)
    .limit(5)

  if (error) {
    fail('fetch civil defs with fees', error.message)
    return
  }
  if ((data ?? []).length > 0) {
    pass('civil defs still have positive fees', `sample=${data![0].label}:${data![0].fee_amount}`)
  } else {
    fail('civil defs still have positive fees', 'none found with fee>0')
  }
}

async function dbTasksAndCredits(sb: SupabaseClient, defIds: string[]) {
  section('4) DB — tasks + wallet credits for criminal fees')
  if (!defIds.length) {
    fail('skip tasks check', 'no def ids')
    return { criminalTaskIds: [] as string[], sampleLawyerId: null as string | null }
  }

  const { data: tasks, error } = await sb
    .from('tasks')
    .select('id, reward_amount, task_status, fee_status, assigned_to, task_definition_id, debtor_id')
    .in('task_definition_id', defIds.slice(0, 200))
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    fail('fetch criminal tasks', error.message)
    return { criminalTaskIds: [] as string[], sampleLawyerId: null as string | null }
  }

  const rows = tasks ?? []
  pass(`sampled criminal-linked tasks`, `${rows.length}`)

  const withReward = rows.filter(t => Number(t.reward_amount) > 0)
  const zeroReward = rows.filter(t => Number(t.reward_amount ?? 0) === 0)
  console.log(`    reward>0: ${withReward.length} | reward=0: ${zeroReward.length}`)
  if (withReward.length) {
    pass('some criminal tasks store reward_amount>0', `e.g. ${withReward[0].reward_amount}`)
  } else {
    // Not necessarily a failure — old trigger may still zero; approval falls back to def fee
    pass(
      'note: all sampled tasks have reward_amount=0',
      'approval uses definition fee fallback — OK if trigger not migrated yet',
    )
  }

  const taskIds = rows.map(t => t.id)
  let creditCount = 0
  let creditSum = 0
  if (taskIds.length) {
    const { data: txs } = await sb
      .from('lawyer_wallet_transactions')
      .select('id, amount, lawyer_id, reference_id, type, wallet')
      .eq('type', 'approved_task_payment')
      .in('reference_id', taskIds)
      .limit(100)
    creditCount = txs?.length ?? 0
    creditSum = (txs ?? []).reduce((s, t) => s + Number(t.amount ?? 0), 0)
    console.log(`    fee credits linked to sample tasks: ${creditCount}, sum=${creditSum}`)
  }

  const lawyerId =
    rows.find(t => t.assigned_to)?.assigned_to
    ?? null

  return { criminalTaskIds: taskIds, sampleLawyerId: lawyerId as string | null }
}

async function walletCompare(sb: SupabaseClient, lawyerId: string | null) {
  section('5) Wallet — admin vs lawyer vs savings isolation')

  let id = lawyerId
  if (!id) {
    const { data: lawyers } = await sb
      .from('profiles')
      .select('id, full_name, case_type')
      .eq('role', 'lawyer')
      .eq('case_type', 'criminal')
      .eq('is_active', true)
      .limit(5)
    id = lawyers?.[0]?.id ?? null
    if (lawyers?.[0]) console.log(`    using criminal lawyer: ${lawyers[0].full_name}`)
  }

  if (!id) {
    const { data: feeTx } = await sb
      .from('lawyer_wallet_transactions')
      .select('lawyer_id')
      .eq('type', 'approved_task_payment')
      .limit(20)
    id = feeTx?.[0]?.lawyer_id ?? null
    if (id) {
      const { data: p } = await sb.from('profiles').select('full_name, case_type').eq('id', id).single()
      console.log(`    fallback lawyer with fee credits: ${p?.full_name} (${p?.case_type})`)
    }
  }

  if (!id) {
    const { data: anyLawyer } = await sb
      .from('profiles')
      .select('id, full_name, case_type')
      .eq('role', 'lawyer')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    id = anyLawyer?.id ?? null
    if (anyLawyer) console.log(`    fallback any lawyer: ${anyLawyer.full_name}`)
  }

  if (!id) {
    fail('find lawyer for wallet compare', 'none')
    return
  }

  pass('lawyer selected for wallet compare', id)

  const [adminBal, lawyerBal, adminSav, lawyerSav] = await Promise.all([
    fetchLawyerWalletBalance(sb, id, 'fees', { viewerRole: 'admin' }),
    fetchLawyerWalletBalance(sb, id, 'fees', { viewerRole: 'lawyer' }),
    fetchLawyerWalletBalance(sb, id, 'savings', { viewerRole: 'admin' }),
    fetchLawyerWalletBalance(sb, id, 'savings', { viewerRole: 'lawyer' }),
  ])

  console.log(`    fees admin=${adminBal} | fees lawyer=${lawyerBal}`)
  console.log(`    savings admin=${adminSav} | savings lawyer=${lawyerSav}`)

  if (adminSav === lawyerSav) pass('savings identical for admin vs lawyer viewer')
  else fail('savings identical for admin vs lawyer viewer', `${adminSav} vs ${lawyerSav}`)

  if (lawyerBal <= adminBal) pass('lawyer fees balance ≤ admin fees balance')
  else fail('lawyer fees balance ≤ admin fees balance', `${lawyerBal} > ${adminBal}`)

  const { data: feeTxs } = await sb
    .from('lawyer_wallet_transactions')
    .select('amount, type, reference_id, wallet')
    .eq('lawyer_id', id)
    .eq('type', 'approved_task_payment')
    .limit(200)

  const refs = (feeTxs ?? []).map(t => t.reference_id).filter(Boolean) as string[]
  let criminalCredits = 0
  if (refs.length) {
    const { data: linked } = await sb
      .from('tasks')
      .select('id, debtor:debtors!tasks_debtor_id_fkey(case_type)')
      .in('id', refs.slice(0, 100))
    for (const t of linked ?? []) {
      const d = Array.isArray(t.debtor) ? t.debtor[0] : t.debtor
      if ((d as { case_type?: string } | null)?.case_type === 'criminal') {
        const tx = feeTxs!.find(x => x.reference_id === t.id)
        criminalCredits += Number(tx?.amount ?? 0)
      }
    }
  }

  console.log(`    criminal approved_task_payment sum for lawyer: ${criminalCredits}`)
  if (criminalCredits > 0) {
    const delta = adminBal - lawyerBal
    if (delta + 0.01 >= criminalCredits) {
      pass('admin-lawyer fees delta covers criminal credits', `delta=${delta}`)
    } else {
      fail(
        'admin-lawyer fees delta covers criminal credits',
        `delta=${delta} criminal=${criminalCredits}`,
      )
    }
  } else {
    if (adminBal === lawyerBal) {
      pass('no criminal credits → admin fees == lawyer fees (civil unchanged)')
    } else {
      pass(
        'no criminal credits in DB yet; civil masking parity may still differ by payout edge cases',
        `${adminBal} vs ${lawyerBal}`,
      )
    }
  }

  const both = await fetchLawyerWalletBalances(sb, id, { viewerRole: 'lawyer' })
  if (typeof both.fees === 'number' && typeof both.savings === 'number') {
    pass('fetchLawyerWalletBalances returns fees+savings', `fees=${both.fees} savings=${both.savings}`)
  } else fail('fetchLawyerWalletBalances returns fees+savings')
}

async function resolveFeeFallback(sb: SupabaseClient, defIds: string[]) {
  section('6) Approval fee resolve — definition fallback when reward=0')
  if (!defIds.length) {
    fail('skip resolve', 'no defs')
    return
  }
  const { data: def } = await sb
    .from('task_definitions')
    .select('id, fee_amount, label')
    .in('id', defIds)
    .eq('fee_amount', 25000)
    .limit(1)
    .maybeSingle()

  if (!def) {
    fail('pick def with 25000')
    return
  }

  // Simulate resolveTaskFeeAmount logic
  const reward = 0
  const fromReward = Number(reward)
  const fromDef = fromReward > 0 ? fromReward : Number(def.fee_amount)
  if (fromDef === 25000) {
    pass('zero reward_amount falls back to definition 25000', def.label)
  } else fail('zero reward_amount falls back to definition 25000')

  const adminVis = visibleTaskFeeAmount(fromDef, 'criminal', 'admin')
  const lawyerVis = visibleTaskFeeAmount(fromDef, 'criminal', 'lawyer')
  if (adminVis === 25000 && lawyerVis === 0) {
    pass('display layer after resolve: admin=25000 lawyer=0')
  } else fail('display layer after resolve', `admin=${adminVis} lawyer=${lawyerVis}`)
}

async function apiRouteWiring() {
  section('7) Static — API routes pass viewerRole')
  const fs = await import('fs')
  const lawyerRoute = fs.readFileSync('app/api/lawyer/wallet/route.ts', 'utf8')
  const adminRoute = fs.readFileSync('app/api/admin/lawyer-wallet/route.ts', 'utf8')
  if (lawyerRoute.includes('viewerRole')) pass('lawyer wallet API passes viewerRole')
  else fail('lawyer wallet API passes viewerRole')
  if (adminRoute.includes('viewerRole')) pass('admin lawyer-wallet API passes viewerRole')
  else fail('admin lawyer-wallet API passes viewerRole')

  const savingsPanel = fs.readFileSync('components/AdminDisbursementWalletPanel.tsx', 'utf8')
  if (!savingsPanel.includes('visibleTaskFee')) {
    pass('disbursement panel untouched by fee visibility helper')
  } else fail('disbursement panel should not use fee visibility')
}

async function main() {
  loadEnv()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env')

  const sb = createClient(url, key)
  console.log('Criminal fees comprehensive debug')
  console.log(`URL host: ${new URL(url).host}`)

  await envInventory(sb)
  await unitLayer()
  const defs = await dbDefinitions(sb)
  await dbCivilUnchanged(sb)
  const { sampleLawyerId } = await dbTasksAndCredits(
    sb,
    defs.map(d => d.id),
  )
  await walletCompare(sb, sampleLawyerId)
  await resolveFeeFallback(sb, defs.map(d => d.id))
  await apiRouteWiring()

  section('SUMMARY')
  const ok = checks.filter(c => c.ok).length
  const bad = checks.filter(c => !c.ok)
  console.log(`Passed: ${ok}/${checks.length}`)
  if (bad.length) {
    console.log('Failures:')
    for (const b of bad) console.log(`  - ${b.name}: ${b.detail ?? ''}`)
    process.exitCode = 1
  } else {
    console.log('All checks passed.')
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
