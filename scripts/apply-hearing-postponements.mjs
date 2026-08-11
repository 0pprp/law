/** تطبيق جدول hearing_postponements — يتطلب DATABASE_URL أو SUPABASE_DB_URL */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function loadEnv() {
  const path = resolve(root, '.env.local')
  if (!existsSync(path)) return {}
  let raw = readFileSync(path, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter(l => l && !l.trim().startsWith('#'))
      .map(l => {
        const i = l.indexOf('=')
        if (i <= 0) return null
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
      })
      .filter(Boolean),
  )
}

const env = { ...loadEnv(), ...process.env }

async function probe() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return false
  const c = createClient(url, key, { auth: { persistSession: false } })
  const { error } = await c.from('hearing_postponements').select('id').limit(1)
  if (!error) {
    console.log('OK: hearing_postponements موجود مسبقاً')
    return true
  }
  console.log('probe:', error.message)
  return false
}

async function main() {
  if (await probe()) return

  const databaseUrl = env.DATABASE_URL || env.SUPABASE_DB_URL
  if (!databaseUrl) {
    console.error('Missing DATABASE_URL / SUPABASE_DB_URL — طبّق supabase/scripts/apply-hearing-postponements.sql يدوياً')
    process.exit(1)
  }

  const sql = readFileSync(resolve(root, 'supabase/scripts/apply-hearing-postponements.sql'), 'utf8')
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    console.log('Applied hearing_postponements')
  } finally {
    await client.end()
  }

  if (!(await probe())) {
    console.error('الجدول ما زال غير ظاهر بعد التطبيق')
    process.exit(1)
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
