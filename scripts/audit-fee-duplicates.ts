import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

function loadEnv() {
  let raw = readFileSync('.env.local', 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
}

async function main() {
  loadEnv()
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: txs } = await supabase
    .from('lawyer_wallet_transactions')
    .select('id, lawyer_id, amount, type, wallet, reference_id, notes, created_at')
    .gt('amount', 0)
    .in('type', ['approved_task_payment', 'manual_adjustment'])
    .not('reference_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)

  const groups = new Map<string, { count: number; sum: number; lawyerId: string; rows: typeof txs }>()
  for (const tx of txs ?? []) {
    const key = `${tx.lawyer_id}::${tx.reference_id}`
    const g = groups.get(key) ?? { count: 0, sum: 0, lawyerId: tx.lawyer_id as string, rows: [] }
    g.count++
    g.sum += Number(tx.amount)
    g.rows!.push(tx)
    groups.set(key, g)
  }

  const dupes = [...groups.entries()].filter(([, g]) => g.count > 1)
  console.log(`Task-linked positive credits: ${txs?.length ?? 0}`)
  console.log(`Duplicate reference groups: ${dupes.length}`)

  for (const [key, g] of dupes) {
    console.log(`\n${key} — ${g.count} txs, sum=${g.sum}`)
    for (const tx of g.rows ?? []) {
      console.log(`  +${tx.amount} ${tx.type} wallet=${tx.wallet} ${tx.notes}`)
    }
  }

  const taskIds = [...new Set((txs ?? []).map(t => t.reference_id).filter(Boolean))]
  if (!taskIds.length) return

  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, reward_amount, task_definition_id, task_definitions(fee_amount, label)')
    .in('id', taskIds.slice(0, 100))

  const expected = new Map<string, number>()
  for (const t of tasks ?? []) {
    const def = Array.isArray(t.task_definitions) ? t.task_definitions[0] : t.task_definitions
    const fee = Number(def?.fee_amount ?? t.reward_amount ?? 0)
    expected.set(t.id, fee)
  }

  console.log('\nOver-credited tasks (sum > expected fee):')
  for (const [key, g] of groups) {
    const taskId = key.split('::')[1]
    const exp = expected.get(taskId) ?? 0
    if (exp > 0 && g.sum > exp) {
      console.log(`  task ${taskId}: credited ${g.sum}, expected ${exp}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
