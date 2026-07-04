/**
 * Creates a مراقب عام (viewer) test user.
 * Usage: npx tsx scripts/seed-viewer-user.ts
 *
 * Default: username `viewer`, password `admin12`
 * Override: VIEWER_USERNAME=... VIEWER_PASSWORD=...
 */
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { usernameToInternalEmail } from '../lib/auth-username'
import { APPROVED_BRANCH_NAMES } from '../lib/branch-constants'

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')

  const username = (process.env.VIEWER_USERNAME ?? 'viewer').trim().toLowerCase()
  const password = process.env.VIEWER_PASSWORD ?? 'admin12'
  const fullName = process.env.VIEWER_FULL_NAME ?? 'مدير القانونية'

  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: branch } = await admin
    .from('branches')
    .select('id, name')
    .eq('is_active', true)
    .in('name', [...APPROVED_BRANCH_NAMES])
    .order('name')
    .limit(1)
    .maybeSingle()

  if (!branch) throw new Error('No active branch found — create a branch first')

  const { data: existing } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
  if (existing) {
    console.log(`User "${username}" already exists (id=${existing.id}). Skipping create.`)
    return
  }

  const email = usernameToInternalEmail(username)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: 'viewer' },
  })
  if (authError || !authData.user) throw new Error(authError?.message ?? 'createUser failed')

  const profileUpdate = {
    username,
    full_name: fullName,
    phone: '07000000000',
    role: 'viewer' as const,
    is_active: true,
    governorate: branch.name,
    branch_id: branch.id,
    identity_number: null,
    identity_category: null,
  }

  const { error: profileError } = await admin.from('profiles').update(profileUpdate).eq('id', authData.user.id)
  if (profileError) {
    await admin.from('profiles').upsert({ id: authData.user.id, ...profileUpdate })
  }

  console.log('Created viewer user:')
  console.log(`  username: ${username}`)
  console.log(`  password: ${password}`)
  console.log(`  branch:   ${branch.name}`)
  console.log(`  id:       ${authData.user.id}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
