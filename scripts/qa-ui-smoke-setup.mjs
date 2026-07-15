/**
 * Short-lived UI smoke users: qa_ui_legal, qa_ui_acct, qa_ui_lawyer
 *   node --env-file=.env.local scripts/qa-ui-smoke-setup.mjs
 *   node --env-file=.env.local scripts/qa-ui-smoke-setup.mjs --cleanup
 */
import { createClient } from '@supabase/supabase-js'

const PASSWORD = 'QaTest12'
const SAVINGS = 500_000
const cleanup = process.argv.includes('--cleanup')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing Supabase env')
  process.exit(1)
}
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const USERS = [
  { username: 'qa_ui_legal', full_name: 'مسؤول قانونية QA اختبار UI', role: 'viewer' },
  { username: 'qa_ui_acct', full_name: 'محاسب QA اختبار UI', role: 'accountant', accountant_type: 'branch' },
  {
    username: 'qa_ui_lawyer',
    full_name: 'محامي QA اختبار UI',
    role: 'lawyer',
    lawyer_type: 'normal',
    identity_number: '1888777666555',
    identity_category: 'هوية وطنية',
  },
]

const QA_USERNAME_PREFIXES = ['qa_ui_', 'qa_legal2', 'qa_acct2', 'qa_lawyer2']

function emailOf(u) {
  return `${u}@internal.qalat.local`
}

function isQaProfile(p) {
  const u = String(p.username ?? '').toLowerCase()
  const n = String(p.full_name ?? '')
  if (u.startsWith('qa_ui_')) return true
  if (u === 'qa_legal2' || u === 'qa_acct2' || u === 'qa_lawyer2') return true
  // Other qa_* only when clearly labeled as QA/test in the name
  if (u.startsWith('qa_') && /(QA|دورة|اختبار)/i.test(n)) return true
  return false
}

function isQaDebtor(d) {
  const name = String(d.full_name ?? '')
  const receipt = String(d.receipt_number ?? '').toUpperCase()
  if (/مدين\s*QA|^مدين QA|QA\s*اختبار|QA\s*دورة/i.test(name)) return true
  if (receipt.startsWith('QA-') || receipt.startsWith('TEST-')) return true
  return false
}

async function getBranch() {
  const preferred = ['بغداد الرصافة', 'النجف الأشرف', 'بغداد الكرخ']
  const { data } = await admin.from('branches').select('id, name').eq('is_active', true).order('name')
  for (const name of preferred) {
    const hit = (data ?? []).find(b => b.name === name)
    if (hit) return hit
  }
  return data?.[0] ?? null
}

async function ensureUser(spec, branchId) {
  const clean = spec.username.toLowerCase()
  const { data: existing } = await admin.from('profiles').select('id').eq('username', clean).maybeSingle()
  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD })
    console.log(`  exists+pw reset: ${clean}`)
    return existing.id
  }
  const email = emailOf(clean)
  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  let userId = listed?.users?.find(u => u.email?.toLowerCase() === email)?.id
  if (!userId) {
    const { data: authData, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: spec.full_name, role: spec.role },
    })
    if (error || !authData.user) throw new Error(`createUser ${clean}: ${error?.message}`)
    userId = authData.user.id
  } else {
    await admin.auth.admin.updateUserById(userId, { password: PASSWORD })
  }
  const profile = {
    username: clean,
    full_name: spec.full_name,
    phone: '07708880001',
    role: spec.role,
    is_active: true,
    branch_id: branchId,
    governorate: 'بغداد الرصافة',
    identity_number: spec.identity_number ?? null,
    identity_category: spec.identity_category ?? null,
    lawyer_type: spec.lawyer_type ?? 'normal',
    accountant_type: spec.accountant_type ?? 'branch',
  }
  const { error: pe } = await admin.from('profiles').upsert({ id: userId, ...profile })
  if (pe) throw new Error(`profile ${clean}: ${pe.message}`)
  console.log(`  created: ${clean}`)
  return userId
}

async function fundSavings(lawyerId, createdBy) {
  const { data: txs } = await admin
    .from('lawyer_wallet_transactions')
    .select('amount, wallet, type')
    .eq('lawyer_id', lawyerId)
  const DISB = new Set([
    'accountant_transfer',
    'transfer_from_savings',
    'savings_withdrawal',
    'task_expense_deduction',
    'lawyer_expense_wallet_deduction',
  ])
  const current = (txs ?? []).reduce((s, r) => {
    if (r.wallet === 'savings') return s + Number(r.amount ?? 0)
    if (!r.wallet && DISB.has(r.type)) return s + Number(r.amount ?? 0)
    return s
  }, 0)
  const delta = SAVINGS - current
  if (delta <= 0) {
    console.log(`  savings already >= ${SAVINGS} (${current})`)
    return
  }
  const { error } = await admin.from('lawyer_wallet_transactions').insert({
    lawyer_id: lawyerId,
    type: 'accountant_transfer',
    wallet: 'savings',
    amount: delta,
    notes: 'QA UI smoke — تمويل 500 ألف',
    created_by: createdBy,
  })
  if (error) throw new Error(error.message)
  console.log(`  funded +${delta}`)
}

async function deleteUsers(ids) {
  for (const id of ids) {
    await admin.auth.admin.deleteUser(id)
  }
}

async function cleanupAll() {
  console.log('\n=== CLEANUP QA UI + leftover qa_* ===\n')
  const { data: profiles } = await admin.from('profiles').select('id, username, full_name, role')
  const testUsers = (profiles ?? []).filter(isQaProfile)
  const testUserIds = testUsers.map(p => p.id)
  console.log(`QA users to delete (${testUsers.length}):`)
  for (const p of testUsers) console.log(`  - [${p.role}] ${p.username} — ${p.full_name}`)

  const { data: debtors } = await admin.from('debtors').select('id, full_name, receipt_number, created_by')
  const byCreator = (debtors ?? []).filter(d => testUserIds.includes(d.created_by))
  const byName = (debtors ?? []).filter(isQaDebtor)
  const map = new Map()
  for (const d of [...byCreator, ...byName]) map.set(d.id, d)
  const testDebtors = [...map.values()]
  const testDebtorIds = testDebtors.map(d => d.id)
  console.log(`QA debtors to delete (${testDebtors.length}):`)
  for (const d of testDebtors) console.log(`  - ${d.full_name} / ${d.receipt_number}`)

  const taskIds = new Set()
  if (testDebtorIds.length) {
    const { data } = await admin.from('tasks').select('id').in('debtor_id', testDebtorIds)
    for (const t of data ?? []) taskIds.add(t.id)
  }
  if (testUserIds.length) {
    const { data } = await admin.from('tasks').select('id').in('assigned_to', testUserIds)
    for (const t of data ?? []) taskIds.add(t.id)
  }
  const tids = [...taskIds]

  const counts = { users: testUsers.length, debtors: testDebtors.length, tasks: tids.length }

  if (tids.length) {
    await admin.from('task_expenses').delete().in('task_id', tids)
    await admin.from('lawyer_attachments').delete().in('task_id', tids)
    await admin.from('tasks').delete().in('id', tids)
  }
  if (testDebtorIds.length) {
    await admin.from('tasks').delete().in('debtor_id', testDebtorIds)
    await admin.from('debtors').delete().in('id', testDebtorIds)
  }
  if (testUserIds.length) {
    await admin.from('activity_logs').delete().in('user_id', testUserIds)
    await admin.from('lawyer_wallet_transactions').delete().in('lawyer_id', testUserIds)
    await admin.from('lawyer_wallet_transactions').delete().in('created_by', testUserIds)
    await admin.from('lawyer_payout_requests').delete().in('lawyer_id', testUserIds)
    await admin.from('profiles').delete().in('id', testUserIds)
    await deleteUsers(testUserIds)
  }

  // Final verify
  const { data: left } = await admin.from('profiles').select('username, full_name')
  const leftover = (left ?? []).filter(p => {
    const u = String(p.username ?? '').toLowerCase()
    const n = String(p.full_name ?? '')
    if (u.startsWith('qa_ui_') || u === 'qa_legal2' || u === 'qa_acct2' || u === 'qa_lawyer2') return true
    if (u.startsWith('qa_') && /(QA|دورة|اختبار)/i.test(n)) return true
    return false
  })
  console.log('\nCounts:', JSON.stringify(counts))
  console.log('Leftover qa profiles:', leftover.length ? leftover : 0)
  return { counts, leftover }
}

async function setup() {
  console.log('\n=== SETUP qa_ui_* users ===\n')
  const branch = await getBranch()
  if (!branch) throw new Error('No branch')
  console.log(`branch: ${branch.name} (${branch.id})`)
  const ids = {}
  for (const spec of USERS) {
    ids[spec.username] = await ensureUser(spec, branch.id)
  }
  await fundSavings(ids.qa_ui_lawyer, ids.qa_ui_acct)
  console.log('\nDone. Password:', PASSWORD)
  console.log(JSON.stringify({ branch, ids }, null, 2))
}

if (cleanup) await cleanupAll()
else await setup()
