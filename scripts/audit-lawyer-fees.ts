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
  const lawyerId = process.argv[2] ?? 'b8c7ce83-9acb-4472-97ab-704dba0535cd'

  const { data: txs } = await supabase
    .from('lawyer_wallet_transactions')
    .select('id, amount, type, wallet, reference_id, notes, created_at')
    .eq('lawyer_id', lawyerId)
    .gt('amount', 0)
    .order('created_at', { ascending: false })
    .limit(50)

  console.log('Positive fee credits:', txs?.length ?? 0)
  for (const tx of txs ?? []) {
    console.log(`${tx.created_at} | +${tx.amount} | ${tx.type} | wallet=${tx.wallet} | ref=${tx.reference_id} | ${tx.notes}`)
  }

  const byRef = new Map<string, number>()
  for (const tx of txs ?? []) {
    const ref = tx.reference_id ?? 'none'
    byRef.set(ref, (byRef.get(ref) ?? 0) + Number(tx.amount))
  }
  console.log('\nSum by reference_id:')
  for (const [ref, sum] of byRef) {
    if (ref !== 'none') console.log(`  ${ref}: ${sum}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
