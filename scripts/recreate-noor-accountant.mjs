/**
 * Recreate general accountant "نور الهدى" with same username/password.
 * Usage: node scripts/recreate-noor-accountant.mjs
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function loadEnv() {
  const path = resolve(root, '.env.local')
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter(l => l && !l.trimStart().startsWith('#'))
      .map(l => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
      }),
  )
}

function usernameToInternalEmail(username) {
  return `${username.trim().toLowerCase()}@internal.qalat.local`
}

const env = { ...loadEnv(), ...process.env }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

const CANDIDATE_PASSWORDS = [
  'noor',
  'Noor',
  'NOOR',
  'noor123',
  'noor12',
  '123456',
  'admin12',
  'noralhuda',
  'nooralhuda',
  'نور',
]

async function findProfile() {
  const { data: byName } = await admin
    .from('profiles')
    .select('*')
    .ilike('full_name', '%نور%')

  const general = (byName ?? []).filter(
    p => p.role === 'accountant' && p.accountant_type === 'general',
  )
  if (general.length === 1) return general[0]
  if (general.length > 1) {
    console.log('Multiple matches:', general.map(p => ({ id: p.id, full_name: p.full_name, username: p.username })))
    return general.find(p => /هدى|الهدى/.test(p.full_name ?? '')) ?? general[0]
  }

  const { data: accts } = await admin
    .from('profiles')
    .select('*')
    .eq('role', 'accountant')
    .eq('accountant_type', 'general')

  console.log('All general accountants:', (accts ?? []).map(p => ({
    id: p.id,
    full_name: p.full_name,
    username: p.username,
  })))

  const hit = (accts ?? []).find(p => /نور|هدى|الهدى|noor/i.test(`${p.full_name} ${p.username}`))
  return hit ?? null
}

async function discoverPassword(profile) {
  const { data: authUser } = await admin.auth.admin.getUserById(profile.id)
  const email = authUser?.user?.email || usernameToInternalEmail(profile.username)
  const passwords = [
    ...CANDIDATE_PASSWORDS,
    profile.username,
    String(profile.username ?? '').toLowerCase(),
    String(profile.phone ?? '').replace(/\D/g, '').slice(-6),
  ].filter(Boolean)

  for (const password of [...new Set(passwords)]) {
    const { data, error } = await anon.auth.signInWithPassword({ email, password })
    if (!error && data.session) {
      await anon.auth.signOut()
      return { password, email }
    }
  }
  return { password: null, email }
}

async function nullify(table, column, userId) {
  const { error } = await admin.from(table).update({ [column]: null }).eq(column, userId)
  if (error) console.warn(`nullify ${table}.${column}:`, error.message)
}

async function detachUserReferences(userId) {
  await nullify('tasks', 'assigned_to', userId)
  await nullify('tasks', 'assignment_rejected_by', userId)
  await nullify('tasks', 'created_by', userId)
  await admin.from('lawyer_attachments').delete().eq('lawyer_id', userId)
  await nullify('lawyer_attachments', 'uploaded_by', userId)
  await admin.from('lawyer_wallet_transactions').delete().eq('lawyer_id', userId)
  await nullify('lawyer_wallet_transactions', 'created_by', userId)
  await admin.from('delegate_wallet_transactions').delete().eq('delegate_id', userId)
  await nullify('delegate_wallet_transactions', 'created_by', userId)
  await nullify('expenses', 'created_by', userId)
  await nullify('lawyer_payout_requests', 'reviewed_by', userId)
  await nullify('debtors', 'created_by', userId)
  await nullify('payments', 'created_by', userId)
  await nullify('branch_lists', 'created_by', userId)
  await nullify('finance_requests', 'created_by', userId)
  await nullify('finance_requests', 'reviewed_by', userId)
  await nullify('payment_noncompliance_reviews', 'reviewed_by', userId)
  await nullify('debtor_files', 'uploaded_by', userId)
  await nullify('task_files', 'uploaded_by', userId)
  const { error: logNullErr } = await admin.from('activity_logs').update({ user_id: null }).eq('user_id', userId)
  if (logNullErr) {
    await admin.from('activity_logs').delete().eq('user_id', userId)
  }
}

async function main() {
  const forcedPassword = process.env.NOOR_PASSWORD?.trim() || null
  const profile = await findProfile()
  if (!profile) {
    console.error('لم يتم العثور على حساب نور الهدى (محاسب عام)')
    process.exit(1)
  }

  console.log('Found:', {
    id: profile.id,
    full_name: profile.full_name,
    username: profile.username,
    accountant_type: profile.accountant_type,
    branch_id: profile.branch_id,
    phone: profile.phone,
    is_active: profile.is_active,
  })

  let password = forcedPassword
  let email = usernameToInternalEmail(profile.username)
  if (!password) {
    const discovered = await discoverPassword(profile)
    email = discovered.email
    password = discovered.password
  }

  if (!password) {
    console.error('تعذر اكتشاف كلمة المرور الحالية.')
    console.error('أعد التشغيل مع: NOOR_PASSWORD=الكلمة node scripts/recreate-noor-accountant.mjs')
    process.exit(1)
  }

  console.log('Using password length:', password.length, 'email:', email)

  const snapshot = {
    username: String(profile.username).trim().toLowerCase(),
    full_name: profile.full_name,
    phone: profile.phone,
    role: 'accountant',
    is_active: profile.is_active !== false,
    governorate: profile.governorate,
    identity_type: profile.identity_type ?? null,
    identity_number: profile.identity_number ?? null,
    identity_category: profile.identity_category ?? null,
    lawyer_type: 'normal',
    accountant_type: 'general',
    case_type: profile.case_type ?? 'civil',
    branch_id: profile.branch_id,
  }

  if (!snapshot.username || !snapshot.full_name || !snapshot.phone || !snapshot.branch_id) {
    console.error('بيانات الملف ناقصة لإعادة الإنشاء:', snapshot)
    process.exit(1)
  }

  console.log('Detaching references + deleting old account...')
  await detachUserReferences(profile.id)
  const { error: profileDelErr } = await admin.from('profiles').delete().eq('id', profile.id)
  if (profileDelErr) {
    console.error('profile delete failed:', profileDelErr.message)
    process.exit(1)
  }
  const { error: authDelErr } = await admin.auth.admin.deleteUser(profile.id)
  if (authDelErr && !/not found/i.test(authDelErr.message)) {
    console.error('auth delete failed:', authDelErr.message)
    process.exit(1)
  }

  console.log('Creating new account...')
  const internalEmail = usernameToInternalEmail(snapshot.username)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: internalEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: snapshot.full_name, role: 'accountant' },
  })
  if (authError || !authData.user) {
    console.error('createUser failed:', authError?.message)
    process.exit(1)
  }

  let { error: profileError } = await admin.from('profiles').update(snapshot).eq('id', authData.user.id)
  if (profileError) {
    ;({ error: profileError } = await admin.from('profiles').upsert({ id: authData.user.id, ...snapshot }))
  }
  if (profileError) {
    console.error('profile update failed:', profileError.message)
    await admin.auth.admin.deleteUser(authData.user.id)
    process.exit(1)
  }

  // Verify login
  const { data: loginData, error: loginErr } = await anon.auth.signInWithPassword({
    email: internalEmail,
    password,
  })
  if (loginErr || !loginData.session) {
    console.error('verify login failed:', loginErr?.message)
    process.exit(1)
  }
  await anon.auth.signOut()

  const { data: created } = await admin
    .from('profiles')
    .select('id, username, full_name, role, accountant_type, branch_id, phone, is_active')
    .eq('id', authData.user.id)
    .single()

  console.log('OK recreated:', created)
  console.log(`username=${snapshot.username}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
