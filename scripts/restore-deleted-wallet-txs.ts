/**
 * استرجاع حركات محفظة المحامين المرتبطة بمهام الـ 38 مديناً المحذوفين.
 * إدراج فقط — لا حذف.
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/restore-deleted-wallet-txs.ts
 * Confirm:  npx tsx --env-file=.env.local scripts/restore-deleted-wallet-txs.ts --confirm
 */
import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const confirm = process.argv.includes('--confirm')
const report = JSON.parse(readFileSync('scripts/delete-return-to-payment-report.json', 'utf8')) as {
  deletedNames: { id: string; name: string }[]
}
const DEBTOR_IDS = report.deletedNames.map(d => d.id)

function client(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false } })
}

async function fetchInChunks(
  sb: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
  select = '*',
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40)
    const { data, error } = await sb.from(table).select(select).in(column, chunk)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as Record<string, unknown>[]))
  }
  return out
}

async function main() {
  const src = client(process.env.RESTORE_SUPABASE_URL!, process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY!)
  const dst = client(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const tasks = await fetchInChunks(src, 'tasks', 'debtor_id', DEBTOR_IDS, 'id, debtor_id')
  const taskIds = tasks.map(t => String(t.id))
  console.log('tasks from deleted debtors:', taskIds.length)

  const txs = await fetchInChunks(src, 'lawyer_wallet_transactions', 'reference_id', taskIds)
  console.log('wallet txs linked to those tasks in restore:', txs.length)

  // أيضاً stationery إن وُجد
  let stationery: Record<string, unknown>[] = []
  try {
    stationery = await fetchInChunks(src, 'lawyer_stationery_transactions', 'reference_id', taskIds)
  } catch {
    stationery = []
  }
  console.log('stationery txs:', stationery.length)

  // ما الناقص في الإنتاج؟
  const missing: Record<string, unknown>[] = []
  for (const tx of txs) {
    const id = String(tx.id)
    const { data: exists } = await dst.from('lawyer_wallet_transactions').select('id').eq('id', id).maybeSingle()
    if (!exists) missing.push(tx)
  }
  console.log('missing wallet txs in prod:', missing.length)

  const byLawyer = new Map<string, { n: number; sum: number; types: string[] }>()
  for (const tx of missing) {
    const lid = String(tx.lawyer_id)
    const cur = byLawyer.get(lid) ?? { n: 0, sum: 0, types: [] }
    cur.n++
    cur.sum += Number(tx.amount) || 0
    cur.types.push(`${tx.wallet}/${tx.type}:${tx.amount}`)
    byLawyer.set(lid, cur)
  }

  const lawyerIds = [...byLawyer.keys()]
  const { data: lawyers } = lawyerIds.length
    ? await dst.from('profiles').select('id, full_name').in('id', lawyerIds)
    : { data: [] as { id: string; full_name: string }[] }
  const nameMap = new Map((lawyers ?? []).map(l => [l.id, l.full_name]))

  console.log('\nPer lawyer missing:')
  for (const [lid, info] of byLawyer) {
    console.log(`  ${nameMap.get(lid) ?? lid}: n=${info.n} sum=${info.sum}`)
    for (const t of info.types) console.log(`    - ${t}`)
  }

  if (!confirm) {
    console.log('\nDry-run. Re-run with --confirm to INSERT missing wallet txs.')
    return
  }

  let inserted = 0
  let failed = 0
  for (const tx of missing) {
    const { error } = await dst.from('lawyer_wallet_transactions').insert(tx)
    if (error) {
      failed++
      console.error(`fail ${tx.id}: ${error.message}`)
    } else {
      inserted++
    }
  }

  // stationery
  let stInserted = 0
  for (const tx of stationery) {
    const id = String(tx.id)
    const { data: exists } = await dst.from('lawyer_stationery_transactions').select('id').eq('id', id).maybeSingle()
    if (exists) continue
    const { error } = await dst.from('lawyer_stationery_transactions').insert(tx)
    if (error) console.error(`stationery fail ${id}: ${error.message}`)
    else stInserted++
  }

  console.log(`\nDone. wallet inserted=${inserted} failed=${failed} stationery inserted=${stInserted}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
