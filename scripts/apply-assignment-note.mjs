/**
 * تطبيق عمود debtors.assignment_note
 * يتطلب DATABASE_URL أو SUPABASE_DB_URL في .env.local
 *
 * مثال:
 *   postgresql://postgres.[ref]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
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
  const { error } = await c.from('debtors').select('id, assignment_note').limit(1)
  if (!error) {
    console.log('OK: assignment_note موجود مسبقاً')
    return true
  }
  console.log('probe:', error.message)
  return false
}

async function main() {
  if (await probe()) return

  const databaseUrl = env.DATABASE_URL || env.SUPABASE_DB_URL
  if (!databaseUrl) {
    console.log('DATABASE_URL غير موجود في .env.local')
    console.log('شغّل يدوياً في Supabase SQL Editor:')
    console.log('  supabase/scripts/apply-debtor-assignment-note.sql')
    process.exit(1)
  }

  const sql = readFileSync(resolve(root, 'supabase/scripts/apply-debtor-assignment-note.sql'), 'utf8')
  const pg = await import('pg')
  const client = new pg.default.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  await client.query(sql)
  await client.end()
  console.log('OK: تم تطبيق assignment_note')

  if (!(await probe())) {
    console.log('تحذير: التطبيق نجح لكن الـ probe ما زال يفشل')
    process.exit(1)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
