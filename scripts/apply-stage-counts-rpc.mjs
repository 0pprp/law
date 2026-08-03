/**
 * Apply get_stage_counts RPC + performance indexes.
 * Requires DATABASE_URL or SUPABASE_DB_URL in .env.local
 *
 *   node scripts/apply-stage-counts-rpc.mjs
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const SQL_PATH = resolve(root, 'supabase/scripts/apply-stage-counts-rpc.sql')

function loadEnv() {
  const path = resolve(root, '.env.local')
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter(l => l && !l.trimStart().startsWith('#'))
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
  const c = createClient(url, key, { auth: { persistSession: false } })
  const { error } = await c.rpc('get_stage_counts', {
    p_branch_id: null,
    p_case_type: 'civil',
    p_branch_list_id: null,
    p_today: new Date().toISOString().slice(0, 10),
  })
  if (!error) {
    console.log('OK: get_stage_counts RPC ready')
    return true
  }
  console.log('probe:', error.message)
  return false
}

async function main() {
  if (await probe()) return

  const databaseUrl = env.DATABASE_URL || env.SUPABASE_DB_URL
  if (!databaseUrl) {
    console.log('DATABASE_URL غير موجود — شغّل يدوياً في Supabase SQL Editor:')
    console.log('  supabase/scripts/apply-stage-counts-rpc.sql')
    process.exit(1)
  }

  const sql = readFileSync(SQL_PATH, 'utf8')
  const pg = await import('pg')
  const client = new pg.default.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()
  await client.query(sql)
  await client.end()
  console.log('OK: applied stage-counts RPC + indexes')

  if (!(await probe())) process.exit(1)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
