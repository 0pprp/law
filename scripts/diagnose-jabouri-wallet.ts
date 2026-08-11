/**
 * تشخيص محفظة المحامي محمود الجبوري: إنتاج vs استرجاع
 * npx tsx --env-file=.env.local scripts/diagnose-jabouri-wallet.ts
 */
import { createClient } from '@supabase/supabase-js'

function client(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false } })
}

async function inspect(label: string, url: string, key: string) {
  const sb = client(url, key)
  console.log(`\n===== ${label} =====`)

  const { data: lawyers, error } = await sb
    .from('profiles')
    .select('id, full_name, role, username, branch_id')
    .ilike('full_name', '%محمود%جبور%')
  if (error) throw new Error(error.message)
  console.log('matches:', lawyers?.length)
  for (const p of lawyers ?? []) console.log(p)

  const lawyer = lawyers?.[0]
  if (!lawyer) return

  const { data: wallet } = await sb
    .from('lawyer_wallets')
    .select('*')
    .eq('lawyer_id', lawyer.id)
    .maybeSingle()
  console.log('wallet:', wallet)

  const { data: txs, error: txErr } = await sb
    .from('lawyer_wallet_transactions')
    .select('id, amount, type, reference_id, notes, created_at, balance_after')
    .eq('lawyer_id', lawyer.id)
    .order('created_at', { ascending: false })
    .limit(40)
  if (txErr) console.log('tx err', txErr.message)
  console.log('recent txs:', txs?.length)
  let sum = 0
  const { data: allTx } = await sb
    .from('lawyer_wallet_transactions')
    .select('amount, type')
    .eq('lawyer_id', lawyer.id)
  for (const t of allTx ?? []) sum += Number(t.amount) || 0
  console.log('tx count:', allTx?.length, 'sum(amount):', sum)
  console.log('latest 10:')
  for (const t of (txs ?? []).slice(0, 10)) {
    console.log(`  ${t.created_at} | ${t.type} | ${t.amount} | ref=${t.reference_id} | ${t.notes ?? ''}`)
  }
}

async function main() {
  await inspect('PROD', process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  await inspect('RESTORE', process.env.RESTORE_SUPABASE_URL!, process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY!)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
