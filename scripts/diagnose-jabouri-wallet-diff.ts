/**
 * مقارنة حركات محفظة محمود الجبوري — إنتاج vs استرجاع
 */
import { createClient } from '@supabase/supabase-js'

function client(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false } })
}

const LAWYER_ID = 'a4a1a8ef-4d6b-4795-88f0-989d5c19fcb6'

async function load(label: string, url: string, key: string) {
  const sb = client(url, key)
  const { data, error } = await sb
    .from('lawyer_wallet_transactions')
    .select('id, amount, type, reference_id, notes, created_at, wallet')
    .eq('lawyer_id', LAWYER_ID)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`${label}: ${error.message}`)

  const byType = new Map<string, { n: number; sum: number }>()
  let sum = 0
  for (const t of data ?? []) {
    const amt = Number(t.amount) || 0
    sum += amt
    const k = `${t.wallet ?? 'null'}|${t.type}`
    const cur = byType.get(k) ?? { n: 0, sum: 0 }
    cur.n++
    cur.sum += amt
    byType.set(k, cur)
  }
  console.log(`\n===== ${label} =====`)
  console.log('rows', data?.length, 'sum_all', sum)
  for (const [k, v] of [...byType.entries()].sort()) console.log(`  ${k}: n=${v.n} sum=${v.sum}`)

  // رصيد الأتعاب التقريبي: approved_task_payment + fee_payout وما شابه
  const feesTypes = new Set(['approved_task_payment', 'fee_payout', 'manual_adjustment'])
  const feesSum = (data ?? [])
    .filter(t => (t.wallet === 'fees' || (!t.wallet && feesTypes.has(String(t.type)))) || t.type === 'approved_task_payment' || t.type === 'fee_payout')
    .reduce((s, t) => s + Number(t.amount || 0), 0)
  console.log('approx fees-related sum:', feesSum)

  return data ?? []
}

async function main() {
  const prod = await load('PROD', process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const rest = await load('RESTORE', process.env.RESTORE_SUPABASE_URL!, process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY!)

  const prodMap = new Map(prod.map(t => [t.id, t]))
  const restMap = new Map(rest.map(t => [t.id, t]))

  const onlyRestore = rest.filter(t => !prodMap.has(t.id))
  const onlyProd = prod.filter(t => !restMap.has(t.id))

  console.log('\n--- Missing in PROD (exist in restore) ---', onlyRestore.length)
  for (const t of onlyRestore) {
    console.log(`  ${t.created_at} | ${t.wallet} | ${t.type} | ${t.amount} | ref=${t.reference_id} | ${t.notes}`)
  }
  console.log('\n--- Extra in PROD (not in restore) ---', onlyProd.length)
  for (const t of onlyProd) {
    console.log(`  ${t.created_at} | ${t.wallet} | ${t.type} | ${t.amount} | ref=${t.reference_id} | ${t.notes}`)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
