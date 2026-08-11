/**
 * نسخ 38 مديناً محذوفاً + مهامهم من مشروع الاسترجاع → الإنتاج.
 * إدراج فقط — لا يحذف ولا يستبدل الموجود.
 *
 * في .env.local أضف:
 *   RESTORE_SUPABASE_URL=https://mocfkwdxjdtqmjowazxd.supabase.co
 *   RESTORE_SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Dry-run:  npx tsx --env-file=.env.local scripts/restore-deleted-debtors-from-backup-project.ts
 * Confirm:  npx tsx --env-file=.env.local scripts/restore-deleted-debtors-from-backup-project.ts --confirm
 */
import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const confirm = process.argv.includes('--confirm')

const report = JSON.parse(readFileSync('scripts/delete-return-to-payment-report.json', 'utf8')) as {
  deletedNames: { id: string; name: string; branch: string }[]
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
  const CHUNK = 50
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    const { data, error } = await sb.from(table).select('*').in(column, chunk)
    if (error) throw new Error(`${table}: ${error.message}`)
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
  const prodUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const restoreUrl = process.env.RESTORE_SUPABASE_URL
  const restoreKey = process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY

  if (!prodUrl || !prodKey) throw new Error('Missing production Supabase env')
  if (!restoreUrl || !restoreKey) {
    throw new Error(
      'Missing RESTORE_SUPABASE_URL / RESTORE_SUPABASE_SERVICE_ROLE_KEY — أضفهما من مشروع «استرجاع» → Settings → API',
    )
  }

  const src = client(restoreUrl, restoreKey)
  const dst = client(prodUrl, prodKey)

  console.log(`Source (restore): ${restoreUrl}`)
  console.log(`Target (prod):    ${prodUrl}`)
  console.log(`Debtor IDs: ${DEBTOR_IDS.length}`)

  // تحقق أن المصدر فيه الأسماء
  const srcDebtors = await fetchAllByIds(src, 'debtors', 'id', DEBTOR_IDS)
  console.log(`Found in restore project: ${srcDebtors.length}/${DEBTOR_IDS.length}`)
  if (!srcDebtors.length) throw new Error('لا مدينين في مشروع الاسترجاع لهذه الـ IDs')

  const missing = DEBTOR_IDS.filter(id => !srcDebtors.some(d => d.id === id))
  if (missing.length) {
    console.log('Missing in restore:', missing.length)
    for (const id of missing) {
      const name = report.deletedNames.find(d => d.id === id)?.name
      console.log(`  - ${name} (${id})`)
    }
  }

  const srcTasks = await fetchAllByIds(src, 'tasks', 'debtor_id', DEBTOR_IDS)
  console.log(`Tasks in restore: ${srcTasks.length}`)

  // ملاحظات اختيارية (بدون مرفقات تخزين)
  const srcNotes = await fetchAllByIds(src, 'debtor_notes', 'debtor_id', DEBTOR_IDS).catch(() => [])
  console.log(`Notes in restore: ${srcNotes.length}`)

  // تحقق الإنتاج: لا نستبدل الموجود
  const already = await fetchAllByIds(dst, 'debtors', 'id', DEBTOR_IDS)
  console.log(`Already in production: ${already.length}`)

  if (!confirm) {
    console.log('\nDry-run OK. Re-run with --confirm to INSERT missing debtors + tasks only.')
    console.log('Will NOT delete or update existing rows.')
    return
  }

  // 1) أدرج المدينين بدون current_task_id / last_task_id أولاً
  const debtorsToInsert = srcDebtors.map(d => {
    const copy = { ...d }
    copy.current_task_id = null
    copy.last_task_id = null
    return copy
  })

  const dRes = await insertIgnoreExisting(dst, 'debtors', debtorsToInsert)
  console.log(`Debtors: inserted=${dRes.inserted} skipped=${dRes.skipped}`)
  if (dRes.failed.length) {
    console.error('Debtor failures:')
    for (const f of dRes.failed) console.error(' ', f)
  }

  // 2) أدرج المهام
  const tRes = await insertIgnoreExisting(dst, 'tasks', srcTasks)
  console.log(`Tasks: inserted=${tRes.inserted} skipped=${tRes.skipped}`)
  if (tRes.failed.length) {
    console.error('Task failures:')
    for (const f of tRes.failed) console.error(' ', f)
  }

  // 3) أعد ربط current_task_id / last_task_id من المصدر (فقط إن المدين موجود والقيم فارغة أو نحدّث من المصدر)
  let linked = 0
  for (const d of srcDebtors) {
    const id = String(d.id)
    const { data: prod } = await dst
      .from('debtors')
      .select('id, current_task_id, last_task_id')
      .eq('id', id)
      .maybeSingle()
    if (!prod) continue

    const patch: Record<string, unknown> = {}
    if (!prod.current_task_id && d.current_task_id) patch.current_task_id = d.current_task_id
    if (!prod.last_task_id && d.last_task_id) patch.last_task_id = d.last_task_id
    if (!Object.keys(patch).length) continue

    // تأكد أن المهمة موجودة في الإنتاج
    if (patch.current_task_id) {
      const { data: t } = await dst.from('tasks').select('id').eq('id', String(patch.current_task_id)).maybeSingle()
      if (!t) delete patch.current_task_id
    }
    if (patch.last_task_id) {
      const { data: t } = await dst.from('tasks').select('id').eq('id', String(patch.last_task_id)).maybeSingle()
      if (!t) delete patch.last_task_id
    }
    if (!Object.keys(patch).length) continue

    const { error } = await dst.from('debtors').update(patch).eq('id', id)
    if (!error) linked++
    else console.error(`link ${id}:`, error.message)
  }
  console.log(`Linked current/last task: ${linked}`)

  // 4) ملاحظات
  if (srcNotes.length) {
    const nRes = await insertIgnoreExisting(dst, 'debtor_notes', srcNotes)
    console.log(`Notes: inserted=${nRes.inserted} skipped=${nRes.skipped} failed=${nRes.failed.length}`)
    for (const f of nRes.failed) console.error(' ', f)
  }

  // تحقق نهائي
  const finalDebtors = await fetchAllByIds(dst, 'debtors', 'id', DEBTOR_IDS)
  const finalTasks = await fetchAllByIds(dst, 'tasks', 'debtor_id', DEBTOR_IDS)
  console.log('\n=== Done ===')
  console.log(`Debtors now in prod: ${finalDebtors.length}/${DEBTOR_IDS.length}`)
  console.log(`Tasks now in prod:   ${finalTasks.length}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
