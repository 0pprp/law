/**
 * Update existing admin login credentials (no data wipe, no new user).
 * Run:
 *   set ADMIN_NEW_PASSWORD=haider12
 *   node --env-file=.env.local scripts/update-admin-credentials.mjs
 *
 * Optional env:
 *   ADMIN_EMAIL=ahmedalsaewdi8789@gmail.com
 *   ADMIN_NEW_USERNAME=haider
 *   ADMIN_NEW_FULL_NAME=حيدر
 *   ADMIN_NEW_PASSWORD=...   (required)
 */
import { createClient } from '@supabase/supabase-js'

const INTERNAL_EMAIL_DOMAIN = 'internal.qalat.local'

function usernameToInternalEmail(username) {
  return `${String(username).trim().toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const oldEmail = (process.env.ADMIN_EMAIL ?? 'ahmedalsaedi8789@gmail.com').trim().toLowerCase()
const newUsername = (process.env.ADMIN_NEW_USERNAME ?? 'haider').trim().toLowerCase()
const newFullName = process.env.ADMIN_NEW_FULL_NAME ?? 'حيدر'
const newPassword = process.env.ADMIN_NEW_PASSWORD

if (!newPassword) {
  console.error('ADMIN_NEW_PASSWORD is required (do not commit it to the repo)')
  process.exit(1)
}

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
const newInternalEmail = usernameToInternalEmail(newUsername)

async function findAuthUserByEmail(email) {
  let page = 1
  while (page <= 20) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const hit = data.users.find(u => u.email?.toLowerCase() === email)
    if (hit) return hit
    if (data.users.length < 1000) break
    page += 1
  }
  return null
}

console.log(`Looking up admin by email: ${oldEmail}`)

let authUser = await findAuthUserByEmail(oldEmail)

if (!authUser && process.env.ADMIN_USER_ID) {
  const { data } = await admin.auth.admin.getUserById(process.env.ADMIN_USER_ID)
  authUser = data?.user ?? null
}

if (!authUser) {
  const { data: adminProfiles } = await admin
    .from('profiles')
    .select('id, username, full_name, role')
    .eq('role', 'admin')
    .eq('is_active', true)

  if (adminProfiles?.length === 1) {
    const { data } = await admin.auth.admin.getUserById(adminProfiles[0].id)
    authUser = data?.user ?? null
    if (authUser) {
      console.log(`Resolved admin via single active admin profile (username=${adminProfiles[0].username})`)
    }
  }
}

if (!authUser) {
  console.error(`No auth user found with email ${oldEmail}`)
  process.exit(1)
}

const userId = authUser.id
console.log(`Found auth user id=${userId}`)

const { data: profile, error: profileErr } = await admin
  .from('profiles')
  .select('id, username, full_name, role, is_active, branch_id')
  .eq('id', userId)
  .maybeSingle()

if (profileErr) {
  console.error('profile lookup failed:', profileErr.message)
  process.exit(1)
}
if (!profile) {
  console.error('No profile row for this auth user')
  process.exit(1)
}
if (profile.role !== 'admin') {
  console.error(`Refusing to update: role is "${profile.role}", expected "admin"`)
  process.exit(1)
}

const { data: usernameTaken } = await admin
  .from('profiles')
  .select('id, username, role, full_name')
  .eq('username', newUsername)
  .neq('id', userId)
  .maybeSingle()

if (usernameTaken) {
  const releaseUsername = `${newUsername}_lawyer`
  console.warn(
    `Username "${newUsername}" is used by ${usernameTaken.role} id=${usernameTaken.id} (${usernameTaken.full_name}). Releasing as "${releaseUsername}".`,
  )
  const { error: releaseErr } = await admin
    .from('profiles')
    .update({ username: releaseUsername })
    .eq('id', usernameTaken.id)
  if (releaseErr) {
    console.error(`Could not release username "${newUsername}":`, releaseErr.message)
    process.exit(1)
  }
}

const internalTaken = await findAuthUserByEmail(newInternalEmail)
if (internalTaken && internalTaken.id !== userId) {
  console.error(`Internal email ${newInternalEmail} is already used by id=${internalTaken.id}`)
  process.exit(1)
}

const { error: authUpdateErr } = await admin.auth.admin.updateUserById(userId, {
  email: newInternalEmail,
  password: newPassword,
  email_confirm: true,
  user_metadata: {
    ...authUser.user_metadata,
    full_name: newFullName,
    role: 'admin',
  },
})

if (authUpdateErr) {
  console.error('auth update failed:', authUpdateErr.message)
  process.exit(1)
}

const { error: profileUpdateErr } = await admin
  .from('profiles')
  .update({
    username: newUsername,
    full_name: newFullName,
    role: 'admin',
    is_active: true,
  })
  .eq('id', userId)

if (profileUpdateErr) {
  console.error('profile update failed:', profileUpdateErr.message)
  process.exit(1)
}

const { data: verifyProfile } = await admin
  .from('profiles')
  .select('id, username, full_name, role, is_active')
  .eq('id', userId)
  .single()

const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { error: signInErr } = await anon.auth.signInWithPassword({
  email: newInternalEmail,
  password: newPassword,
})

if (signInErr) {
  console.error('Login verification failed:', signInErr.message)
  process.exit(1)
}

const { data: viewerProfile } = await admin
  .from('profiles')
  .select('id, username, role')
  .eq('username', 'admin12')
  .maybeSingle()

console.log('Admin credentials updated successfully:')
console.log(`  id:       ${userId}`)
console.log(`  username: ${verifyProfile?.username}`)
console.log(`  full_name:${verifyProfile?.full_name}`)
console.log(`  role:     ${verifyProfile?.role}`)
console.log(`  active:   ${verifyProfile?.is_active}`)
console.log(`  auth email (internal): ${newInternalEmail}`)
console.log('Login test: OK')

if (viewerProfile) {
  console.log(`Viewer account preserved: username=${viewerProfile.username}, role=${viewerProfile.role}`)
} else {
  console.warn('Note: viewer account admin12 not found (unchanged by this script)')
}
