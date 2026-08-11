import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

function loadEnv() {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  let raw = readFileSync(path, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
}

loadEnv()
const a = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function main() {
  const { data: allCc, error } = await a
    .from('criminal_case_task_definitions')
    .select('id, label, branch_id, is_active, sort_order')
    .order('label')
  if (error) {
    console.error('criminal_case_task_definitions error:', error.message)
    return
  }
  console.log('total criminal_case_task_definitions rows:', allCc?.length ?? 0)

  const byLabel = new Map<string, { active: number; branches: Set<string> }>()
  for (const r of allCc ?? []) {
    const k = String(r.label ?? '').trim()
    const prev = byLabel.get(k) ?? { active: 0, branches: new Set() }
    if (r.is_active !== false) prev.active += 1
    if (r.branch_id) prev.branches.add(r.branch_id)
    byLabel.set(k, prev)
  }
  console.log('unique labels:', byLabel.size)
  for (const [k, v] of [...byLabel.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ar'))) {
    console.log(`  - ${k} | activeCopies=${v.active} branches=${v.branches.size}`)
  }

  // sample branch with most defs
  const countByBranch = new Map<string, number>()
  for (const r of allCc ?? []) {
    if (r.is_active === false) continue
    countByBranch.set(r.branch_id, (countByBranch.get(r.branch_id) ?? 0) + 1)
  }
  const top = [...countByBranch.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  console.log('\ntop branches by active defs:')
  for (const [bid, n] of top) {
    const { data: b } = await a.from('branches').select('name').eq('id', bid).maybeSingle()
    console.log(`  ${b?.name ?? bid}: ${n}`)
    const { data: td } = await a
      .from('task_definitions')
      .select('label, task_type, is_active')
      .eq('branch_id', bid)
      .eq('case_type', 'criminal')
    console.log(`    task_definitions criminal: ${td?.length ?? 0}`)
    console.log('   ', (td ?? []).map(x => x.label).join(' | '))
  }

  // try insert custom to see if enum works
  const testBranch = top[0]?.[0]
  if (testBranch) {
    const { error: insErr } = await a.from('task_definitions').insert({
      branch_id: testBranch,
      label: '__sync_probe_custom__',
      fee_amount: 0,
      sort_order: 9999,
      is_active: false,
      case_type: 'criminal',
      task_type: 'custom',
    })
    console.log('\ncustom insert probe:', insErr?.message ?? 'OK')
    if (!insErr) {
      await a.from('task_definitions').delete().eq('branch_id', testBranch).eq('label', '__sync_probe_custom__')
    }
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
