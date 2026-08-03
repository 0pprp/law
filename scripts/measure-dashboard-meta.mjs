/**
 * يقيس زمن scanCurrentTaskMeta عبر RPC مقابل المسح القديماثي، ويقارن الأرقام.
 *
 *   node scripts/measure-dashboard-meta.mjs
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
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })
const TERMINAL = '(completed,closed,failed,approved,rejected)'
const today = new Date().toISOString().slice(0, 10)

async function legacyScan(caseType) {
  const stageCounts = new Map()
  const assignedStageCounts = new Map()
  const overdueStageCounts = new Map()
  let unassigned = 0
  let assigned = 0
  const CHUNK = 500
  let offset = 0

  while (true) {
    let debtorsQ = supabase
      .from('debtors')
      .select('current_task_id')
      .not('case_status', 'eq', 'closed')
      .not('current_task_id', 'is', null)
      .is('special_status_id', null)
      .order('id')
      .range(offset, offset + CHUNK - 1)
    if (caseType) debtorsQ = debtorsQ.eq('case_type', caseType)

    const { data: debtors, error } = await debtorsQ
    if (error) throw new Error(error.message)
    if (!debtors?.length) break

    const taskIds = debtors.map(d => d.current_task_id).filter(Boolean)
    for (let i = 0; i < taskIds.length; i += 200) {
      const batch = taskIds.slice(i, i + 200)
      const { data: tasks, error: tErr } = await supabase
        .from('tasks')
        .select('id, assigned_to, task_definition_id, task_status, due_date')
        .in('id', batch)
        .not('task_status', 'in', TERMINAL)
      if (tErr) throw new Error(tErr.message)
      for (const task of tasks ?? []) {
        const defId = task.task_definition_id
        if (task.assigned_to) {
          assigned++
          if (defId) {
            assignedStageCounts.set(defId, (assignedStageCounts.get(defId) ?? 0) + 1)
            const due = task.due_date ? String(task.due_date).slice(0, 10) : ''
            if (due && due < today) {
              overdueStageCounts.set(defId, (overdueStageCounts.get(defId) ?? 0) + 1)
            }
          }
        } else if (defId) {
          unassigned++
          stageCounts.set(defId, (stageCounts.get(defId) ?? 0) + 1)
        }
      }
    }
    if (debtors.length < CHUNK) break
    offset += CHUNK
  }

  return { unassigned, assigned, stageCounts, assignedStageCounts, overdueStageCounts }
}

function sumMap(m) {
  let n = 0
  for (const v of m.values()) n += v
  return n
}

async function rpcScan(caseType) {
  const { data, error } = await supabase.rpc('get_stage_counts', {
    p_branch_id: null,
    p_case_type: caseType,
    p_branch_list_id: null,
    p_today: today,
  })
  if (error) throw new Error(error.message)
  const stageCounts = new Map()
  const assignedStageCounts = new Map()
  const overdueStageCounts = new Map()
  let unassigned = 0
  let assigned = 0
  for (const row of data ?? []) {
    const defId = row.task_definition_id
    if (!defId) continue
    const u = Number(row.unassigned_count ?? 0)
    const a = Number(row.assigned_count ?? 0)
    const o = Number(row.overdue_count ?? 0)
    if (u > 0) stageCounts.set(defId, u)
    if (a > 0) assignedStageCounts.set(defId, a)
    if (o > 0) overdueStageCounts.set(defId, o)
    unassigned += u
    assigned += a
  }
  return { unassigned, assigned, stageCounts, assignedStageCounts, overdueStageCounts }
}

function summarize(label, meta, ms) {
  console.log(
    `${label}: ${ms}ms | unassigned=${meta.unassigned} assigned=${meta.assigned}` +
      ` stages=${meta.stageCounts.size} overdueSum=${sumMap(meta.overdueStageCounts)}`,
  )
}

async function main() {
  for (const caseType of ['civil', 'criminal']) {
    console.log(`\n=== case_type=${caseType} ===`)
    const t0 = Date.now()
    const legacy = await legacyScan(caseType)
    summarize('legacy', legacy, Date.now() - t0)

    try {
      const t1 = Date.now()
      const rpc = await rpcScan(caseType)
      summarize('rpc   ', rpc, Date.now() - t1)
      const ok =
        legacy.unassigned === rpc.unassigned
        && legacy.assigned === rpc.assigned
        && sumMap(legacy.overdueStageCounts) === sumMap(rpc.overdueStageCounts)
      console.log(ok ? 'MATCH ✓' : 'MISMATCH ✗ — راجع الفلاتر')
    } catch (e) {
      console.log('rpc unavailable:', e.message)
      console.log('شغّل supabase/scripts/apply-stage-counts-rpc.sql في SQL Editor أولاً')
    }
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
