import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

const env = { ...loadEnv(), ...process.env }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

const { data: p, error } = await admin
  .from('profiles')
  .select('id, username, full_name, role')
  .eq('username', 'noor')
  .single()

if (error || !p) {
  console.error(error?.message ?? 'not found')
  process.exit(1)
}

const { error: u } = await admin.auth.admin.updateUserById(p.id, { password: 'noor2000' })
if (u) {
  console.error(u.message)
  process.exit(1)
}

const { error: l } = await anon.auth.signInWithPassword({
  email: 'noor@internal.qalat.local',
  password: 'noor2000',
})
if (l) {
  console.error('login verify failed:', l.message)
  process.exit(1)
}
await anon.auth.signOut()
console.log(`OK: ${p.username} (${p.role}) — password set to noor2000`)
