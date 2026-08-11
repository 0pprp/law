/**
 * 1) إسقاط قيد task_def_type_branch_uniq
 * 2) مزامنة كل المهام الجزائية → task_definitions لكل الفروع
 *
 * npx tsx --env-file=.env.local scripts/apply-and-sync-criminal-task-defs.ts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import pg from 'pg'
import { syncCriminalDefsToTaskDefinitions } from '../lib/sync-criminal-task-definitions'

function loadEnv() {
  const path = resolve(process.cwd(), '.env.local')
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

loadEnv()

async function applySql() {
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL
  if (!databaseUrl) {
    console.warn('لا يوجد DATABASE_URL — طبّق supabase/scripts/apply-task-def-allow-multiple-custom.sql يدوياً ثم أعد التشغيل')
    return false
  }
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/scripts/apply-task-def-allow-multiple-custom.sql'),
    'utf8',
  )
  const client = new pg.Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query(sql)
    console.log('Applied constraint fix')
    return true
  } finally {
    await client.end()
  }
}

async function main() {
  await applySql()

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )

  // probe: second custom insert
  const { data: anyBranch } = await admin.from('branches').select('id').limit(1).maybeSingle()
  if (anyBranch?.id) {
    const { error: e1 } = await admin.from('task_definitions').insert({
      branch_id: anyBranch.id,
      label: '__probe_c1__',
      fee_amount: 0,
      sort_order: 9997,
      is_active: false,
      case_type: 'criminal',
      task_type: 'custom',
    })
    const { error: e2 } = await admin.from('task_definitions').insert({
      branch_id: anyBranch.id,
      label: '__probe_c2__',
      fee_amount: 0,
      sort_order: 9996,
      is_active: false,
      case_type: 'criminal',
      task_type: 'custom',
    })
    console.log('probe custom#1:', e1?.message ?? 'OK')
    console.log('probe custom#2:', e2?.message ?? 'OK')
    await admin.from('task_definitions').delete().in('label', ['__probe_c1__', '__probe_c2__'])
    if (e2?.message?.includes('task_def_type_branch_uniq')) {
      console.error('\n⛔ القيد ما زال موجوداً. نفّذ SQL في Supabase ثم أعد هذا السكربت.')
      process.exit(1)
    }
  }

  const { data: branches } = await admin.from('branches').select('id, name').eq('is_active', true)
  for (const b of branches ?? []) {
    const r = await syncCriminalDefsToTaskDefinitions(admin, b.id)
    console.log(`${b.name}: synced=${r.synced} created=${r.created} updated=${r.updated} errors=${r.errors?.length ?? 0}`)
    if (r.errors?.length) console.log('  ', r.errors.slice(0, 3).join(' | '))
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
