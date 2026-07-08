/**
 * QA test users seed — run: node --env-file=.env.local scripts/qa-seed-users.mjs
 * Idempotent: skips existing usernames; tops up lawyer savings wallet to target.
 */
import { createClient } from '@supabase/supabase-js'

const PASSWORD = process.env.QA_PASSWORD ?? 'QaTest12'
const SAVINGS_TARGET = 500_000

const APPROVED_BRANCH_NAMES = [
  'بغداد الكرخ', 'بغداد الرصافة', 'البصرة', 'الديوانية', 'ديالى',
  'كربلاء', 'كركوك', 'الموصل', 'النجف الأشرف', 'الناصرية', 'السماوة',
]

function usernameToInternalEmail(username) {
  return `${String(username).trim().toLowerCase()}@internal.qalat.local`
}

const USERS = [
  { username: 'qa_admin', full_name: 'مدير اختبار QA', role: 'admin', lawyer_type: 'normal', accountant_type: 'branch' },
  { username: 'qa_legal', full_name: 'مسؤول قانونية QA', role: 'viewer', lawyer_type: 'normal', accountant_type: 'branch' },
  { username: 'qa_lawyer', full_name: 'محامي عادي QA', role: 'lawyer', lawyer_type: 'normal', accountant_type: 'branch', fundSavings: true },
  { username: 'qa_lawyer_gen', full_name: 'محامي عام QA', role: 'lawyer', lawyer_type: 'general', accountant_type: 'branch' },
  { username: 'qa_acct_branch', full_name: 'محاسب فرع QA', role: 'accountant', lawyer_type: 'normal', accountant_type: 'branch' },
  { username: 'qa_acct_gen', full_name: 'محاسب عام QA', role: 'accountant', lawyer_type: 'normal', accountant_type: 'general' },
  { username: 'qa_delegate', full_name: 'مندوب QA', role: 'delegate', lawyer_type: 'normal', accountant_type: 'branch' },
]

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

async function getBranches() {
  const { data, error } = await admin
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
    .in('name', APPROVED_BRANCH_NAMES)
    .order('name')
  if (error || !data?.length) throw new Error(error?.message ?? 'No branches')
  const primary = data.find(b => b.name === 'بغداد الرصافة') ?? data[0]
  const secondary = data.find(b => b.name === 'النجف الأشرف') ?? data[1] ?? primary
  return { primary, secondary, all: data }
}

async function ensureUser(spec, branchId, governorate) {
  const cleanUsername = spec.username.toLowerCase()
  const { data: existing } = await admin.from('profiles').select('id, username').eq('username', cleanUsername).maybeSingle()
  if (existing) {
    console.log(`  exists: ${cleanUsername} (${existing.id})`)
    return existing.id
  }

  const email = usernameToInternalEmail(cleanUsername)
  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const orphan = listed?.users?.find(u => u.email?.toLowerCase() === email)

  let userId
  if (orphan) {
    userId = orphan.id
    await admin.auth.admin.updateUserById(userId, {
      password: PASSWORD,
      user_metadata: { full_name: spec.full_name, role: spec.role },
    })
  } else {
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: spec.full_name, role: spec.role },
    })
    if (authError || !authData.user) throw new Error(authError?.message ?? 'createUser failed')
    userId = authData.user.id
  }

  const profileUpdate = {
    username: cleanUsername,
    full_name: spec.full_name,
    phone: '07700000001',
    role: spec.role,
    is_active: true,
    governorate,
    branch_id: branchId,
    identity_number: spec.role === 'lawyer' ? '12345678901' : null,
    identity_category: spec.role === 'lawyer' ? 'هوية وطنية' : null,
    lawyer_type: spec.lawyer_type,
    accountant_type: spec.accountant_type,
  }

  let { error: profileError } = await admin.from('profiles').update(profileUpdate).eq('id', userId)
  if (profileError) {
    const { error: upsertErr } = await admin.from('profiles').upsert({ id: userId, ...profileUpdate })
    if (upsertErr) throw new Error(upsertErr.message)
  }

  if (spec.role === 'delegate') {
    await admin.from('delegate_wallets').upsert({ delegate_id: userId }, { onConflict: 'delegate_id', ignoreDuplicates: true })
  }

  console.log(`  created: ${cleanUsername} (${userId})`)
  return userId
}

async function sumSavingsBalance(lawyerId) {
  const { data, error } = await admin
    .from('lawyer_wallet_transactions')
    .select('amount, wallet, type')
    .eq('lawyer_id', lawyerId)
    .limit(5000)
  if (error) return 0
  const DISBURSEMENT = new Set(['accountant_transfer', 'transfer_from_savings', 'savings_withdrawal', 'task_expense_deduction', 'lawyer_expense_wallet_deduction'])
  return (data ?? []).reduce((s, r) => {
    if (r.wallet === 'savings') return s + Number(r.amount ?? 0)
    if (!r.wallet && DISBURSEMENT.has(r.type)) return s + Number(r.amount ?? 0)
    return s
  }, 0)
}

async function fundSavingsWallet(lawyerId, createdBy) {
  const current = await sumSavingsBalance(lawyerId)
  const delta = SAVINGS_TARGET - current
  if (delta <= 0) {
    console.log(`  savings wallet OK: ${current}`)
    return
  }
  const row = {
    lawyer_id: lawyerId,
    type: 'accountant_transfer',
    wallet: 'savings',
    amount: delta,
    notes: 'QA seed — محفظة صرفيات',
    created_by: createdBy,
  }
  let { error } = await admin.from('lawyer_wallet_transactions').insert(row)
  if (error?.message?.includes('wallet')) {
    const { wallet: _w, ...legacy } = row
    ;({ error } = await admin.from('lawyer_wallet_transactions').insert(legacy))
  }
  if (error) throw new Error(`wallet fund failed: ${error.message}`)
  console.log(`  funded savings +${delta} (total ~${SAVINGS_TARGET})`)
}

const { primary, secondary } = await getBranches()
console.log(`Branches: primary=${primary.name}, secondary=${secondary.name}`)
console.log(`Password for all QA users: ${PASSWORD}`)

const ids = {}
for (const spec of USERS) {
  const branchId = spec.username === 'qa_acct_gen' || spec.username === 'qa_lawyer_gen'
    ? primary.id
    : spec.username === 'qa_acct_branch' || spec.username === 'qa_delegate'
      ? secondary.id
      : primary.id
  const governorate = spec.username === 'qa_acct_branch' || spec.username === 'qa_delegate'
    ? secondary.name
    : primary.name
  console.log(`\n${spec.username}:`)
  ids[spec.username] = await ensureUser(spec, branchId, governorate)
}

const adminId = ids.qa_admin
for (const spec of USERS) {
  if (spec.fundSavings && ids[spec.username]) {
    console.log(`\nFunding ${spec.username}:`)
    await fundSavingsWallet(ids[spec.username], adminId)
  }
}

console.log('\nQA seed complete.')
console.log(JSON.stringify({ users: Object.keys(ids), password: PASSWORD }, null, 2))
