/**
 * Probe: test accounts + schema facts needed by the audit.
 * Run: node --env-file=.env.local scripts/e2e-full-audit/00-probe.mjs
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(url, key, { auth: { persistSession: false } })

const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
const testUsers = (users?.users ?? []).filter(u => (u.email ?? '').endsWith('@test.local'))
console.log('--- auth users @test.local ---')
for (const u of testUsers) console.log(u.email, u.id)

const ids = testUsers.map(u => u.id)
const { data: profiles, error: pErr } = await admin
  .from('profiles')
  .select('id, username, full_name, role, branch_id, is_active, accountant_type, lawyer_type')
  .in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
console.log('--- profiles ---')
if (pErr) console.log('profiles error:', pErr.message)
for (const p of profiles ?? []) {
  const email = testUsers.find(u => u.id === p.id)?.email
  console.log(JSON.stringify({ email, ...p }))
}

const { data: branches } = await admin.from('branches').select('id, name, is_active').eq('is_active', true).order('name')
console.log('--- active branches ---')
for (const b of branches ?? []) console.log(b.id, b.name)

for (const t of ['criminal_cases', 'criminal_case_task_definitions', 'special_statuses', 'debtor_notes']) {
  const { data, error, count } = await admin.from(t).select('*', { count: 'exact' }).limit(1)
  console.log(`--- ${t} --- count=${count ?? '?'} err=${error?.message ?? 'none'} cols=${data?.[0] ? Object.keys(data[0]).join(',') : 'n/a'}`)
}
