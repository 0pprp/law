/**
 * Change نور الهدى (noor) role to admin — no delete.
 *   node scripts/promote-noor-to-admin.mjs
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

const env = { ...loadEnv(), ...process.env }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const { data: profile, error } = await admin
  .from('profiles')
  .select('id, username, full_name, role, accountant_type, is_active, branch_id')
  .eq('username', 'noor')
  .maybeSingle()

if (error || !profile) {
  console.error('لم يتم العثور على المستخدم noor:', error?.message)
  process.exit(1)
}

console.log('Before:', profile)

const { data: updated, error: updErr } = await admin
  .from('profiles')
  .update({
    role: 'admin',
    accountant_type: 'branch',
  })
  .eq('id', profile.id)
  .select('id, username, full_name, role, accountant_type, is_active, branch_id')
  .single()

if (updErr) {
  console.error('فشل التحديث:', updErr.message)
  process.exit(1)
}

await admin.auth.admin.updateUserById(profile.id, {
  user_metadata: { full_name: profile.full_name, role: 'admin' },
})

console.log('After:', updated)
console.log('OK: noor أصبح admin — نفس الحساب بدون حذف')
