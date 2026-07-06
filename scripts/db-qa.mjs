/**
 * DB/API smoke tests — no UI login required
 * Run: node --env-file=.env.local scripts/db-qa.mjs
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const base = process.env.BASE_URL || 'http://localhost:3000'

if (!url || !key) {
  console.error('Missing Supabase env')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })
const results = []

function log(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const { error: ltErr } = await sb.from('profiles').select('lawyer_type').limit(1)
  log('schema: lawyer_type', !ltErr, ltErr?.message)

  const { error: arErr } = await sb.from('tasks').select('assignment_rejected_by').limit(1)
  log('schema: assignment_rejected_by', !arErr, arErr?.message)

  const { data: gl } = await sb.from('profiles').select('id, username, lawyer_type').eq('lawyer_type', 'general').eq('is_active', true)
  log('general lawyers exist', (gl?.length ?? 0) > 0, gl?.map(u => u.username).join(', '))

  if (gl?.[0]) {
    const { count } = await sb.from('tasks').select('id', { count: 'exact', head: true }).eq('assigned_to', gl[0].id)
    log('general lawyer assignments', true, `count=${count ?? 0}`)
    const { count: rej } = await sb.from('tasks').select('id', { count: 'exact', head: true })
      .eq('assignment_rejected_by', gl[0].id).is('assigned_to', null)
    log('rejection records', true, `count=${rej ?? 0}`)
  }

  const roles = ['admin', 'lawyer', 'viewer', 'accountant']
  for (const role of roles) {
    const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', role).eq('is_active', true)
    const ok = role === 'accountant' ? true : (count ?? 0) > 0
    log(`role: ${role}`, ok, `active=${count ?? 0}`)
  }

  const { count: walletTx } = await sb.from('lawyer_wallet_transactions').select('id', { count: 'exact', head: true })
  log('lawyer wallet transactions', true, `rows=${walletTx ?? 0}`)

  const { count: stale } = await sb.from('tasks').select('id', { count: 'exact', head: true })
    .eq('task_status', 'waiting_assignment').not('give_up_reason', 'is', null).not('assigned_to', 'is', null)
  log('stale rejection tasks', (stale ?? 0) === 0, `count=${stale ?? 0} (run scripts/repair-stale-rejections.mjs if >0)`)

  const apiRes = await fetch(`${base}/api/lawyer/wallet`)
  const apiJson = apiRes.headers.get('content-type')?.includes('json')
  log('API unauth returns JSON 401', apiRes.status === 401 && apiJson, `status=${apiRes.status} json=${apiJson}`)

  const passed = results.filter(r => r.ok).length
  console.log(`\n=== DB QA ${passed}/${results.length} ===`)
  if (passed < results.length) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
