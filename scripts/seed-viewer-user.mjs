/**
 * Creates مراقب عام (viewer) — run: node --env-file=.env.local scripts/seed-viewer-user.mjs
 */
import { createClient } from '@supabase/supabase-js'

const APPROVED_BRANCH_NAMES = [
  'بغداد الكرخ', 'بغداد الرصافة', 'البصرة', 'الديوانية', 'ديالى',
  'كربلاء', 'كركوك', 'الموصل', 'النجف الأشرف', 'الناصرية', 'السماوة',
]

function usernameToInternalEmail(username) {
  const u = String(username).trim().toLowerCase()
  return `${u}@internal.qalat.local`
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const username = (process.env.VIEWER_USERNAME ?? 'viewer').trim().toLowerCase()
const password = process.env.VIEWER_PASSWORD ?? 'admin12'
const fullName = process.env.VIEWER_FULL_NAME ?? 'مدير القانونية'

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: branch } = await admin
  .from('branches')
  .select('id, name')
  .eq('is_active', true)
  .in('name', APPROVED_BRANCH_NAMES)
  .order('name')
  .limit(1)
  .maybeSingle()

if (!branch) {
  console.error('No active branch found')
  process.exit(1)
}

const { data: existing } = await admin.from('profiles').select('id, username').eq('username', username).maybeSingle()
if (existing) {
  console.log(`User "${username}" already exists (id=${existing.id})`)
  process.exit(0)
}

const email = usernameToInternalEmail(username)
const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
const orphanAuth = listed?.users?.find(u => u.email?.toLowerCase() === email)

if (orphanAuth) {
  const profileUpdate = {
    username,
    full_name: fullName,
    phone: '07000000000',
    role: 'viewer',
    is_active: true,
    governorate: branch.name,
    branch_id: branch.id,
    identity_number: null,
    identity_category: null,
  }
  const { error: fixErr } = await admin.from('profiles').update(profileUpdate).eq('id', orphanAuth.id)
  if (fixErr) {
    const { error: upsertErr } = await admin.from('profiles').upsert({ id: orphanAuth.id, ...profileUpdate })
    if (upsertErr) {
      console.error('repair profile failed:', fixErr.message, upsertErr.message)
      process.exit(1)
    }
  }
  await admin.auth.admin.updateUserById(orphanAuth.id, { password, user_metadata: { full_name: fullName, role: 'viewer' } })
  console.log(`Repaired existing auth user → viewer profile:`)
  console.log(`  username: ${username}`)
  console.log(`  password: ${password}`)
  console.log(`  id:       ${orphanAuth.id}`)
  process.exit(0)
}

const { data: authData, error: authError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName, role: 'viewer' },
})

if (authError || !authData.user) {
  console.error('createUser failed:', authError?.message ?? 'unknown')
  process.exit(1)
}

const profileUpdate = {
  username,
  full_name: fullName,
  phone: '07000000000',
  role: 'viewer',
  is_active: true,
  governorate: branch.name,
  branch_id: branch.id,
  identity_number: null,
  identity_category: null,
}

const { error: profileError } = await admin.from('profiles').update(profileUpdate).eq('id', authData.user.id)
if (profileError) {
  const { error: upsertErr } = await admin.from('profiles').upsert({ id: authData.user.id, ...profileUpdate })
  if (upsertErr) {
    console.error('profile update failed:', profileError.message, upsertErr.message)
    process.exit(1)
  }
}

console.log('Created viewer user:')
console.log(`  username: ${username}`)
console.log(`  password: ${password}`)
console.log(`  branch:   ${branch.name}`)
console.log(`  id:       ${authData.user.id}`)
