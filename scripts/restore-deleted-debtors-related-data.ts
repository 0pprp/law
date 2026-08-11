/**
 * استكمال بيانات الـ 38: صرفيات + تسديدات + مرفقات (سجلات DB) + تفاصيل جزائي + مرفقات مهام.
 * إدراج فقط — لا حذف.
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/restore-deleted-debtors-related-data.ts
 * Confirm:  npx tsx --env-file=.env.local scripts/restore-deleted-debtors-related-data.ts --confirm
 */
import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const confirm = process.argv.includes('--confirm')

const report = JSON.parse(readFileSync('scripts/delete-return-to-payment-report.json', 'utf8')) as {
  deletedNames: { id: string; name: string }[]
}
const DEBTOR_IDS = report.deletedNames.map(d => d.id)

function client(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false } })
}

async function fetchAllByIds(
  sb: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
): Promise<Record<string, unknown>[]> {
  if (!ids.length) return []
  const out: Record<string, unknown>[] = []
  const CHUNK = 40
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data, error } = await sb.from(table).select('*').in(column, chunk)
    if (error) {
      if (error.code === '42P01' || String(error.message).includes(table)) {
        console.warn(`  skip missing table ${table}: ${error.message}`)
        return out
      }
      throw new Error(`${table}: ${error.message}`)
    }
    out.push(...((data ?? []) as Record<string, unknown>[]))
  }
  return out
}

async function insertIgnoreExisting(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  idKey = 'id',
): Promise<{ inserted: number; skipped: number; failed: string[] }> {
  let inserted = 0
  let skipped = 0
  const failed: string[] = []
  for (const row of rows) {
    const id = String(row[idKey] ?? '')
    if (!id) {
      failed.push(`${table}: row without ${idKey}`)
      continue
    }
    const { data: existing } = await sb.from(table).select(idKey).eq(idKey, id).maybeSingle()
    if (existing) {
      skipped++
      continue
    }
    const { error } = await sb.from(table).insert(row)
    if (error) failed.push(`${table} ${id}: ${error.message}`)
    else inserted++
  }
  return { inserted, skipped, failed }
}

async function main() {
  const src = client(process.env.RESTORE_SUPABASE_URL!, process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY!)
  const dst = client(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log(`Debtors: ${DEBTOR_IDS.length}`)

  const srcTasks = await fetchAllByIds(src, 'tasks', 'debtor_id', DEBTOR_IDS)
  const taskIds = srcTasks.map(t => String(t.id))
  console.log(`Tasks (for related): ${taskIds.length}`)

  const bundles: { table: string; rows: Record<string, unknown>[]; idKey?: string }[] = []

  const byDebtor = [
    'expenses',
    'debtor_payments',
    'debtor_attachments',
    'debtor_notes',
    'criminal_debtor_details',
    'payment_noncompliance_requests',
  ] as const

  for (const table of byDebtor) {
    const rows = await fetchAllByIds(src, table, 'debtor_id', DEBTOR_IDS)
    // criminal_debtor_details PK is debtor_id
    const idKey = table === 'criminal_debtor_details' ? 'debtor_id' : 'id'
    console.log(`${table}: ${rows.length}`)
    bundles.push({ table, rows, idKey })
  }

  const taskAtts = await fetchAllByIds(src, 'task_attachments', 'task_id', taskIds)
  console.log(`task_attachments: ${taskAtts.length}`)
  bundles.push({ table: 'task_attachments', rows: taskAtts })

  // مصروفات مربوطة بالمهمة فقط (إن وُجدت بلا debtor_id مسبقاً)
  const expByTask = await fetchAllByIds(src, 'expenses', 'task_id', taskIds)
  const expDebtorIds = new Set(
    (bundles.find(b => b.table === 'expenses')?.rows ?? []).map(r => String(r.id)),
  )
  const expExtra = expByTask.filter(r => !expDebtorIds.has(String(r.id)))
  console.log(`expenses extra by task_id: ${expExtra.length}`)
  if (expExtra.length) {
    const expBundle = bundles.find(b => b.table === 'expenses')!
    expBundle.rows.push(...expExtra)
  }

  if (!confirm) {
    console.log('\nDry-run OK. Re-run with --confirm to INSERT related data only.')
    return
  }

  for (const b of bundles) {
    if (!b.rows.length) {
      console.log(`${b.table}: nothing`)
      continue
    }
    const res = await insertIgnoreExisting(dst, b.table, b.rows, b.idKey ?? 'id')
    console.log(`${b.table}: inserted=${res.inserted} skipped=${res.skipped} failed=${res.failed.length}`)
    for (const f of res.failed.slice(0, 20)) console.error('  ', f)
    if (res.failed.length > 20) console.error(`  ... +${res.failed.length - 20} more`)
  }

  console.log('\nDone. Note: ملفات R2/Storage القديمة إن حُذفت فعلياً لن تُسترجع تلقائياً — سجلات المرفقات في DB فقط.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
