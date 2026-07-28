/**
 * إضافة criminal_debtor_details.amount_owed كنص حر
 * يتطلب DATABASE_URL أو SUPABASE_DB_URL في .env.local
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const SQL_PATH = resolve(root, 'supabase/migrations/20260728140000_criminal_amount_owed_text.sql')

function loadEnv() {
  const path = resolve(root, '.env.local')
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(l => l && !l.startsWith('#'))
      .map(l => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
      }),
  )
}

const env = { ...loadEnv(), ...process.env }

async function probe() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return false
  const c = createClient(url, key)
  const { error } = await c.from('criminal_debtor_details').select('amount_owed').limit(1)
  if (error) {
    console.log('probe:', error.message)
    return false
  }
  console.log('OK: amount_owed text موجود')
  return true
}

async function main() {
  if (await probe()) return
  const databaseUrl = env.DATABASE_URL || env.SUPABASE_DB_URL
  if (!databaseUrl) {
    console.log('DATABASE_URL غير موجود — شغّل يدوياً:')
    console.log('  supabase/migrations/20260728140000_criminal_amount_owed_text.sql')
    process.exit(1)
  }
  const sql = readFileSync(SQL_PATH, 'utf8')
  const pg = await import('pg')
  const client = new pg.default.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  await client.query(sql)
  await client.end()
  console.log('OK: تم تطبيق amount_owed text')
  if (!(await probe())) process.exit(1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
