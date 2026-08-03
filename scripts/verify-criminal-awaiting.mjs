/**
 * Verify criminal no-task debtors are returned with the fixed list-scope rules.
 *   node scripts/verify-criminal-awaiting.mjs
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

function statusFilter(q) {
  return q.or('case_status.is.null,case_status.eq.active,and(case_status.neq.closed,case_status.neq.payment_in_progress)')
}

function listFilter(q, branchListId, caseType) {
  const listId = typeof branchListId === 'string' ? branchListId.trim() : ''
  if (!listId) return q
  if (caseType === 'criminal') return q
  if (caseType === 'civil') return q.eq('branch_list_id', listId)
  return q.or(`branch_list_id.eq.${listId},and(case_type.eq.criminal,branch_list_id.is.null)`)
}

async function countCriminal(branchId, caseType, branchListId) {
  let q = sb
    .from('debtors')
    .select('id', { count: 'exact', head: true })
    .is('current_task_id', null)
    .is('special_status_id', null)
    .is('duplicate_flagged_at', null)
  q = statusFilter(q)
  if (branchId) q = q.eq('branch_id', branchId)
  if (caseType) q = q.eq('case_type', caseType)
  q = listFilter(q, branchListId, caseType)
  const { count, error } = await q
  return { count: count ?? 0, error: error?.message ?? null }
}

const { count: allCriminal } = await sb
  .from('debtors')
  .select('id', { count: 'exact', head: true })
  .eq('case_type', 'criminal')
  .is('current_task_id', null)
  .eq('case_status', 'active')

const { data: sample } = await sb
  .from('debtors')
  .select('branch_id')
  .eq('case_type', 'criminal')
  .is('current_task_id', null)
  .eq('case_status', 'active')
  .limit(1)
  .maybeSingle()

const branchId = sample?.branch_id ?? null
const fakeList = '00000000-0000-0000-0000-000000000001'

const a = await countCriminal(branchId, 'criminal', fakeList)
const b = await countCriminal(branchId, 'criminal', null)
const c = await countCriminal(branchId, null, fakeList)

console.log('DB criminal active null-task:', allCriminal)
console.log('branch:', branchId)
console.log('criminal + fake list (should IGNORE list):', a)
console.log('criminal + null list:', b)
console.log('both + fake list (should INCLUDE criminal null-list):', c)

const ok = a.count === b.count && a.count > 0 && c.count >= a.count
console.log(ok ? 'OK ✓ criminal awaiting visible with list scope fix' : 'FAIL ✗')
process.exit(ok ? 0 : 1)
