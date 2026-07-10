/**
 * تطبيق سياسات RLS للمحاسب على مدينين/مرفقات/debtor-files
 * يتطلب DATABASE_URL في .env.local أو متغير البيئة
 * مثال: postgresql://postgres.[ref]:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

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
const databaseUrl = env.DATABASE_URL || env.SUPABASE_DB_URL

if (!databaseUrl) {
  console.log('DATABASE_URL غير موجود في .env.local')
  console.log('شغّل يدوياً في Supabase SQL Editor:')
  console.log('  supabase/scripts/apply-staff-debtor-write.sql')
  process.exit(0)
}

const sql = readFileSync(resolve(root, 'supabase/scripts/apply-staff-debtor-write.sql'), 'utf8')

try {
  const pg = await import('pg')
  const client = new pg.default.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  await client.query(sql)
  await client.end()
  console.log('تم تطبيق سياسات RLS بنجاح.')
} catch (e) {
  console.error('فشل التطبيق:', e.message)
  console.log('شغّل يدوياً: supabase/scripts/apply-staff-debtor-write.sql')
  process.exit(1)
}
