/**
 * Reproduce PaymentOpsCards awaiting count for criminal debtors.
 *   node scripts/probe-awaiting-card-count.mjs
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

const { data: criminals } = await sb
  .from('debtors')
  .select('id, full_name, branch_id, case_status, branch_list_id, special_status_id, duplicate_flagged_at')
  .eq('case_type', 'criminal')
  .is('current_task_id', null)
  .eq('case_status', 'active')

const byBranch = new Map()
for (const d of criminals ?? []) {
  const id = d.branch_id ?? 'null'
  byBranch.set(id, (byBranch.get(id) ?? 0) + 1)
}
console.log('criminal null-task by branch:', Object.fromEntries(byBranch))
console.log('total:', criminals?.length)

const branchIds = [...byBranch.keys()].filter(k => k !== 'null')
const { data: branches } = await sb.from('branches').select('id, name').in('id', branchIds)
console.log('branches:', branches)

// Mirror PaymentOpsCards for each branch + all
async function mirrorCard(scope, caseTypeFilter, listId) {
  const listScope = scope === null || caseTypeFilter === 'criminal' ? null : listId
  // dynamic import of logic via raw queries matching fetchAwaitingAssignmentDebtors
  // Call through duplicated minimal path using supabase only

  const statusOr = 'case_status.is.null,case_status.eq.active,and(case_status.neq.closed,case_status.neq.payment_in_progress)'

  // untyped count (may fail)
  let untypedErr = null
  let untypedCount = 0
  {
    const terminal = '(approved,completed,closed,cancelled,rejected_final)'
    let q = sb
      .from('debtors')
      .select('id, current_task:tasks!current_task_id!inner(id)', { count: 'exact', head: true })
      .is('special_status_id', null)
      .or(statusOr)
      .is('current_task.task_definition_id', null)
      .is('current_task.assigned_to', null)
      .not('current_task.task_status', 'in', terminal)
      .is('duplicate_flagged_at', null)
    if (scope) q = q.eq('branch_id', scope)
    if (caseTypeFilter) q = q.eq('case_type', caseTypeFilter)
    const { count, error } = await q
    untypedErr = error?.message ?? null
    untypedCount = count ?? 0
  }

  let noTask = 0
  let noTaskErr = null
  {
    let q = sb
      .from('debtors')
      .select('id', { count: 'exact', head: true })
      .is('current_task_id', null)
      .is('special_status_id', null)
      .or(statusOr)
      .is('duplicate_flagged_at', null)
    if (scope) q = q.eq('branch_id', scope)
    if (caseTypeFilter) q = q.eq('case_type', caseTypeFilter)
    // listScope ignored for criminal
    if (listScope && caseTypeFilter === 'civil') q = q.eq('branch_list_id', listScope)
    if (listScope && caseTypeFilter === null) {
      q = q.or(`branch_list_id.eq.${listScope},and(case_type.eq.criminal,branch_list_id.is.null)`)
    }
    const { count, error } = await q
    noTaskErr = error?.message ?? null
    noTask = count ?? 0
  }

  // Current code: if untyped errors, WHOLE fetch returns error → card shows 0
  const cardWouldShow = untypedErr ? 0 : untypedCount + noTask
  return { scope, caseTypeFilter, listScope, untypedCount, untypedErr, noTask, noTaskErr, cardWouldShow }
}

console.log('\n--- card simulations ---')
console.log('all+criminal', await mirrorCard(null, 'criminal', null))
for (const b of branchIds) {
  console.log(`branch ${b} criminal`, await mirrorCard(b, 'criminal', null))
  console.log(`branch ${b} both no list`, await mirrorCard(b, null, null))
}
