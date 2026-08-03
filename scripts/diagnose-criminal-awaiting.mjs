/**
 * Diagnose why criminal awaiting-assignment debtors may be hidden.
 *   node scripts/diagnose-criminal-awaiting.mjs
 */
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
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const base = () =>
  sb
    .from('debtors')
    .select('id, full_name, case_status, case_type, current_task_id, branch_id, branch_list_id, special_status_id, duplicate_flagged_at')
    .eq('case_type', 'criminal')
    .is('current_task_id', null)

const { data: raw, error } = await base().limit(50)
console.log('raw criminal null-task:', raw?.length, error?.message)

const { count: c1 } = await sb
  .from('debtors')
  .select('id', { count: 'exact', head: true })
  .eq('case_type', 'criminal')
  .is('current_task_id', null)
  .is('special_status_id', null)
  .or('case_status.is.null,and(case_status.neq.closed,case_status.neq.payment_in_progress)')
console.log('count with current or-filter:', c1)

const { count: c2 } = await sb
  .from('debtors')
  .select('id', { count: 'exact', head: true })
  .eq('case_type', 'criminal')
  .is('current_task_id', null)
  .is('special_status_id', null)
  .or('case_status.is.null,case_status.eq.active')
console.log('count active|null:', c2)

const { count: c3 } = await sb
  .from('debtors')
  .select('id', { count: 'exact', head: true })
  .eq('case_type', 'criminal')
  .is('current_task_id', null)
  .is('special_status_id', null)
  .is('duplicate_flagged_at', null)
  .or('case_status.is.null,and(case_status.neq.closed,case_status.neq.payment_in_progress)')
console.log('count + not duplicate:', c3)

const statuses = {}
const lists = { null: 0, set: 0 }
for (const r of raw ?? []) {
  statuses[r.case_status ?? 'null'] = (statuses[r.case_status ?? 'null'] ?? 0) + 1
  if (r.branch_list_id) lists.set++
  else lists.null++
}
console.log('statuses among sample:', statuses)
console.log('branch_list_id among sample:', lists)
console.log('sample:', (raw ?? []).slice(0, 5).map(r => ({
  name: r.full_name,
  status: r.case_status,
  list: r.branch_list_id,
  special: r.special_status_id,
  dup: r.duplicate_flagged_at,
})))
