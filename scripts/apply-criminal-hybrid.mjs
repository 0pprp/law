/**
 * تطبيق is_hybrid + criminal_case_task_definition_links
 * يتطلب DATABASE_URL أو SUPABASE_DB_URL في .env.local
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const SQL_PATH = resolve(root, 'supabase/migrations/20260728120000_criminal_hybrid_task_definitions.sql')

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
  const { error: colErr } = await c.from('criminal_case_task_definitions').select('id, is_hybrid').limit(1)
  if (colErr) {
    console.log('probe is_hybrid:', colErr.message)
    return false
  }
  const { error: linkErr } = await c.from('criminal_case_task_definition_links').select('id').limit(1)
  if (linkErr) {
    console.log('probe links:', linkErr.message)
    return false
  }
  console.log('OK: schema المهمة الهجينة الجزائية موجود')
  return true
}

async function main() {
  if (await probe()) return

  const databaseUrl = env.DATABASE_URL || env.SUPABASE_DB_URL
  if (!databaseUrl) {
    console.log('DATABASE_URL غير موجود في .env.local')
    console.log('شغّل يدوياً في Supabase SQL Editor:')
    console.log('  supabase/migrations/20260728120000_criminal_hybrid_task_definitions.sql')
    process.exit(1)
  }

  const sql = readFileSync(SQL_PATH, 'utf8')
  const pg = await import('pg')
  const client = new pg.default.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  await client.query(sql)
  await client.end()
  console.log('OK: تم تطبيق criminal hybrid schema')

  if (!(await probe())) {
    console.log('تحذير: التطبيق نجح لكن الـ probe ما زال يفشل')
    process.exit(1)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
