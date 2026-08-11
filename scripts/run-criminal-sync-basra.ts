import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { syncCriminalDefsToTaskDefinitions } from '../lib/sync-criminal-task-definitions'

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
  const { data: b } = await a.from('branches').select('id, name').eq('name', 'البصرة').maybeSingle()
  console.log('branch', b)
  try {
    const result = await syncCriminalDefsToTaskDefinitions(a, b!.id)
    console.log('sync result', result)
  } catch (e) {
    console.error('SYNC FAILED:', e)
  }
  const { data: td } = await a
    .from('task_definitions')
    .select('label, task_type, is_active')
    .eq('branch_id', b!.id)
    .eq('case_type', 'criminal')
    .order('sort_order')
  console.log('after count', td?.length)
  console.log((td ?? []).map(x => `${x.label} (${x.task_type})`).join('\n'))
}

main()
