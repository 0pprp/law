/**
 * Ensures test.criminal_legal_manager@test.local exists (role criminal_legal_manager).
 * Run: node --env-file=.env.local scripts/e2e-full-audit/01-seed-criminal-manager.mjs
 */
import { createClient } from '@supabase/supabase-js'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const EMAIL = 'test.criminal_legal_manager@test.local'
const USERNAME = 'test.criminal_legal_manager'
const PASSWORD = 'TestPass123!'
const BRANCH_ID = '726654de-9037-471a-bb3e-353e8fb5065b' // بغداد الرصافة

const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
let user = (listed?.users ?? []).find(u => (u.email ?? '').toLowerCase() === EMAIL)

if (!user) {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: '[TEST] Criminal Legal Manager', role: 'criminal_legal_manager' },
  })
  if (error) { console.error('createUser failed:', error.message); process.exit(1) }
  user = data.user
  console.log('created auth user', user.id)
} else {
  await admin.auth.admin.updateUserById(user.id, { password: PASSWORD, email_confirm: true })
  console.log('auth user exists', user.id)
}

const profile = {
  id: user.id,
  username: USERNAME,
  full_name: '[TEST] Criminal Legal Manager',
  role: 'criminal_legal_manager',
  is_active: true,
  branch_id: BRANCH_ID,
  governorate: 'بغداد الرصافة',
  phone: '07700000099',
  accountant_type: 'branch',
  lawyer_type: 'normal',
}

const { error: upErr } = await admin.from('profiles').upsert(profile, { onConflict: 'id' })
if (upErr) { console.error('profile upsert failed:', upErr.message); process.exit(1) }

const { data: check } = await admin.from('profiles').select('id, username, role, branch_id, is_active').eq('id', user.id).single()
console.log('profile:', JSON.stringify(check))
