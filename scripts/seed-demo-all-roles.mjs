/**
 * يوزرات تجريبية — حساب واحد لكل صلاحية في قلعة الضمان.
 *
 * لا يحذف بيانات. لإنشاء نسخة فارغة أولاً:
 *   node --env-file=.env.local scripts/reset-production-data.mjs --confirm
 * ثم:
 *   node --env-file=.env.local scripts/seed-demo-all-roles.mjs
 *
 * كلمة المرور الافتراضية لكل الحسابات: DemoQalat26
 * يمكن تغييرها بـ DEMO_PASSWORD=...
 */
import { createClient } from '@supabase/supabase-js'

const PASSWORD = process.env.DEMO_PASSWORD ?? 'DemoQalat26'
const PREFIX = process.env.DEMO_PREFIX ?? 'demo_'

const APPROVED_BRANCH_NAMES = [
  'بغداد الكرخ',
  'بغداد الرصافة',
  'بابل',
  'البصرة',
  'الديوانية',
  'ديالى',
  'كربلاء',
  'كركوك',
  'الموصل',
  'النجف الأشرف',
  'الناصرية',
  'السماوة',
]

/** كل الأدوار + تفرعات المحاسب/المحامي */
const USERS = [
  { username: `${PREFIX}admin`, full_name: 'تجريبي — مدير', role: 'admin' },
  { username: `${PREFIX}employee`, full_name: 'تجريبي — موظف', role: 'employee' },
  {
    username: `${PREFIX}legal`,
    full_name: 'تجريبي — مسؤول الدعاوى المدنية',
    role: 'viewer',
  },
  {
    username: `${PREFIX}criminal`,
    full_name: 'تجريبي — مسؤول الجزائيات',
    role: 'criminal_legal_manager',
  },
  {
    username: `${PREFIX}payment`,
    full_name: 'تجريبي — متابعة التسديد',
    role: 'payment_follow_up',
  },
  {
    username: `${PREFIX}acct_branch`,
    full_name: 'تجريبي — محاسب فرع',
    role: 'accountant',
    accountant_type: 'branch',
    branchName: 'النجف الأشرف',
  },
  {
    username: `${PREFIX}acct_gen`,
    full_name: 'تجريبي — محاسب عام',
    role: 'accountant',
    accountant_type: 'general',
  },
  {
    username: `${PREFIX}chief`,
    full_name: 'تجريبي — محاسب رئيسي',
    role: 'chief_accountant',
    branchName: 'بغداد الرصافة',
    linkChiefBranch: true,
  },
  {
    username: `${PREFIX}branch_mgr`,
    full_name: 'تجريبي — مدير فرع',
    role: 'branch_manager',
    branchName: 'بغداد الرصافة',
  },
  {
    username: `${PREFIX}lawyer`,
    full_name: 'تجريبي — محامي عادي',
    role: 'lawyer',
    lawyer_type: 'normal',
    identity: true,
  },
  {
    username: `${PREFIX}lawyer_gen`,
    full_name: 'تجريبي — محامي عام',
    role: 'lawyer',
    lawyer_type: 'general',
    identity: true,
  },
  {
    username: `${PREFIX}delegate`,
    full_name: 'تجريبي — مندوب',
    role: 'delegate',
    branchName: 'النجف الأشرف',
  },
]

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function usernameToInternalEmail(username) {
  return `${String(username).trim().toLowerCase()}@internal.qalat.local`
}

async function getBranches() {
  const { data, error } = await admin
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
    .in('name', APPROVED_BRANCH_NAMES)
    .order('name')
  if (error || !data?.length) throw new Error(error?.message ?? 'No active branches')
  const byName = Object.fromEntries(data.map(b => [b.name, b]))
  const primary = byName['بغداد الرصافة'] ?? data[0]
  return { primary, byName, all: data }
}

async function ensureUser(spec, defaultBranch) {
  const cleanUsername = spec.username.toLowerCase()
  const branch =
    (spec.branchName && (await findBranch(spec.branchName))) || defaultBranch
  const governorate = branch.name

  const email = usernameToInternalEmail(cleanUsername)
  const { data: existingProf } = await admin
    .from('profiles')
    .select('id, username, role')
    .eq('username', cleanUsername)
    .maybeSingle()

  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const orphan = listed?.users?.find(u => u.email?.toLowerCase() === email)

  let userId = existingProf?.id ?? orphan?.id

  if (userId) {
    await admin.auth.admin.updateUserById(userId, {
      password: PASSWORD,
      email_confirm: true,
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
    branch_id: branch.id,
    identity_number: spec.identity ? '12345678901' : null,
    identity_category: spec.identity ? 'هوية وطنية' : null,
    lawyer_type: spec.lawyer_type ?? 'normal',
    accountant_type: spec.accountant_type ?? 'branch',
  }

  let { error: profileError } = await admin.from('profiles').update(profileUpdate).eq('id', userId)
  if (profileError) {
    const { error: upsertErr } = await admin
      .from('profiles')
      .upsert({ id: userId, ...profileUpdate })
    if (upsertErr) throw new Error(upsertErr.message)
  }

  if (spec.role === 'delegate') {
    await admin
      .from('delegate_wallets')
      .upsert({ delegate_id: userId }, { onConflict: 'delegate_id', ignoreDuplicates: true })
  }

  if (spec.linkChiefBranch) {
    const { data: link } = await admin
      .from('chief_accountant_branches')
      .select('profile_id')
      .eq('profile_id', userId)
      .eq('branch_id', branch.id)
      .maybeSingle()
    if (!link) {
      const { error: linkErr } = await admin.from('chief_accountant_branches').insert({
        profile_id: userId,
        branch_id: branch.id,
      })
      if (linkErr) console.warn(`  warn chief link: ${linkErr.message}`)
    }
  }

  const action = existingProf ? 'updated' : 'created'
  console.log(`  ${action}: ${cleanUsername}  (${spec.role})  → ${governorate}`)
  return { username: cleanUsername, role: spec.role, full_name: spec.full_name, branch: governorate }
}

async function findBranch(name) {
  const { data } = await admin
    .from('branches')
    .select('id, name')
    .eq('name', name)
    .eq('is_active', true)
    .maybeSingle()
  return data
}

const { primary } = await getBranches()
console.log(`Primary branch: ${primary.name}`)
console.log(`Password for all demo users: ${PASSWORD}\n`)

const sheet = []
for (const spec of USERS) {
  console.log(spec.username)
  sheet.push(await ensureUser(spec, primary))
}

console.log('\n========== ورقة الدخول ==========')
console.log(`كلمة المرور لجميع الحسابات: ${PASSWORD}\n`)
console.log('اسم المستخدم\tالصلاحية\tالفرع')
for (const row of sheet) {
  console.log(`${row.username}\t${row.full_name}\t${row.branch}`)
}
console.log('\nDone. seed-demo-all-roles complete.')
