/**
 * Apply stamps-only migration + delete files rows.
 * Run: npx tsx scripts/apply-stationery-stamps-only.ts
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()

function loadEnv() {
  const path = resolve(root, '.env.local')
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

async function main() {
  loadEnv()
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })

  const del = await supabase.from('lawyer_stationery_transactions').delete().eq('item', 'files').select('id')
  if (del.error) console.error('delete files txs:', del.error.message)
  else console.log('deleted files transactions:', del.data?.length ?? 0)

  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
  if (!databaseUrl) {
    console.log('No DATABASE_URL — trying to zero files_balance and leave drop for SQL editor')
    // إن وُجد العمود صفّره (لا يمكن DROP بدون SQL خام)
    const { error: updErr } = await supabase
      .from('lawyer_stationery_wallets')
      .update({ files_balance: 0 } as any)
      .gte('files_balance', 0)
    if (updErr) console.log('files_balance update:', updErr.message)
    else console.log('files_balance zeroed where possible')

    console.log('\nApply this SQL in Supabase SQL Editor:')
    console.log(readFileSync(resolve(root, 'supabase/migrations/20260808120000_stationery_stamps_only.sql'), 'utf8'))
    process.exit(0)
  }

  const sql = readFileSync(resolve(root, 'supabase/migrations/20260808120000_stationery_stamps_only.sql'), 'utf8')
  const pg = await import('pg')
  const client = new (pg as any).default.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    console.log('OK: stamps-only migration applied')
  } finally {
    await client.end()
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
