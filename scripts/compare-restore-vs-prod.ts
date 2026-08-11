/**
 * مقارنة شاملة: الاسترجاع vs الإنتاج لبيانات الـ 38 المحذوفين سابقاً
 * npx tsx --env-file=.env.local scripts/compare-restore-vs-prod.ts
 */
import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const report = JSON.parse(readFileSync('scripts/delete-return-to-payment-report.json', 'utf8')) as {
  deletedNames: { id: string; name: string; branch: string }[]
}
const DEBTOR_IDS = report.deletedNames.map(d => d.id)

function client(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false } })
}

async function fetchIds(
  sb: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
  idCol = 'id',
): Promise<Set<string>> {
  const out = new Set<string>()
  if (!ids.length) return out
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40)
    const { data, error } = await sb.from(table).select(idCol).in(column, chunk)
    if (error) {
      if (error.code === '42P01' || String(error.message).includes('does not exist')) return out
      throw new Error(`${table}: ${error.message}`)
    }
    for (const row of data ?? []) out.add(String((row as Record<string, unknown>)[idCol]))
  }
  return out
}

async function fetchRows(
  sb: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
  select = '*',
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  if (!ids.length) return out
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40)
    const { data, error } = await sb.from(table).select(select).in(column, chunk)
    if (error) {
      if (error.code === '42P01' || String(error.message).includes('does not exist')) return out
      throw new Error(`${table}: ${error.message}`)
    }
    out.push(...((data ?? []) as Record<string, unknown>[]))
  }
  return out
}

function diffSets(label: string, src: Set<string>, dst: Set<string>) {
  const onlySrc = [...src].filter(id => !dst.has(id))
  const onlyDst = [...dst].filter(id => !src.has(id))
  const ok = onlySrc.length === 0 && src.size === dst.size
  console.log(
    `${ok ? '✅' : '❌'} ${label}: restore=${src.size} prod=${dst.size}` +
      (onlySrc.length ? ` missing_in_prod=${onlySrc.length}` : '') +
      (onlyDst.length ? ` extra_in_prod=${onlyDst.length}` : ''),
  )
  return { ok, onlySrc, onlyDst }
}

async function main() {
  const src = client(process.env.RESTORE_SUPABASE_URL!, process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY!)
  const dst = client(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  console.log(`Comparing ${DEBTOR_IDS.length} restored debtors\n`)

  // 1) Debtors
  const srcDebtors = await fetchRows(src, 'debtors', 'id', DEBTOR_IDS)
  const dstDebtors = await fetchRows(dst, 'debtors', 'id', DEBTOR_IDS)
  const d1 = diffSets(
    'debtors',
    new Set(srcDebtors.map(d => String(d.id))),
    new Set(dstDebtors.map(d => String(d.id))),
  )

  // مقارنة حقول مهمة للمدين
  const debtorFieldMismatches: string[] = []
  const fields = [
    'full_name', 'phone', 'branch_id', 'branch_list_id', 'case_type', 'case_status',
    'receipt_number', 'required_amount', 'remaining_amount', 'total_expenses',
    'total_payments', 'current_task_id', 'last_task_id',
  ]
  const dstDebtorMap = new Map(dstDebtors.map(d => [String(d.id), d]))
  for (const s of srcDebtors) {
    const p = dstDebtorMap.get(String(s.id))
    if (!p) continue
    for (const f of fields) {
      const a = s[f] == null ? null : String(s[f])
      const b = p[f] == null ? null : String(p[f])
      if (a !== b) debtorFieldMismatches.push(`${s.full_name}.${f}: restore=${a} prod=${b}`)
    }
  }
  console.log(
    `${debtorFieldMismatches.length === 0 ? '✅' : '⚠️'} debtor key fields: mismatches=${debtorFieldMismatches.length}`,
  )
  for (const m of debtorFieldMismatches.slice(0, 15)) console.log('   ', m)
  if (debtorFieldMismatches.length > 15) console.log(`    ... +${debtorFieldMismatches.length - 15}`)

  // 2) Tasks
  const srcTasks = await fetchRows(src, 'tasks', 'debtor_id', DEBTOR_IDS)
  const dstTasks = await fetchRows(dst, 'tasks', 'debtor_id', DEBTOR_IDS)
  const taskIds = srcTasks.map(t => String(t.id))
  const d2 = diffSets(
    'tasks',
    new Set(srcTasks.map(t => String(t.id))),
    new Set(dstTasks.map(t => String(t.id))),
  )

  const taskFieldMismatches: string[] = []
  const taskFields = [
    'task_status', 'task_type', 'task_definition_id', 'assigned_to', 'reward_amount',
    'due_date', 'fee_status', 'branch_id',
  ]
  const dstTaskMap = new Map(dstTasks.map(t => [String(t.id), t]))
  for (const s of srcTasks) {
    const p = dstTaskMap.get(String(s.id))
    if (!p) continue
    for (const f of taskFields) {
      const a = s[f] == null ? null : String(s[f])
      const b = p[f] == null ? null : String(p[f])
      if (a !== b) taskFieldMismatches.push(`${s.id}.${f}: restore=${a} prod=${b}`)
    }
  }
  console.log(
    `${taskFieldMismatches.length === 0 ? '✅' : '⚠️'} task key fields: mismatches=${taskFieldMismatches.length}`,
  )
  for (const m of taskFieldMismatches.slice(0, 10)) console.log('   ', m)

  // 3) Related tables by debtor_id
  const byDebtorTables: { table: string; idCol?: string }[] = [
    { table: 'expenses' },
    { table: 'debtor_payments' },
    { table: 'debtor_attachments' },
    { table: 'debtor_notes' },
    { table: 'criminal_debtor_details', idCol: 'debtor_id' },
    { table: 'payment_noncompliance_requests' },
  ]
  const relatedOk: boolean[] = []
  for (const { table, idCol } of byDebtorTables) {
    const s = await fetchIds(src, table, 'debtor_id', DEBTOR_IDS, idCol ?? 'id')
    const d = await fetchIds(dst, table, 'debtor_id', DEBTOR_IDS, idCol ?? 'id')
    relatedOk.push(diffSets(table, s, d).ok)
  }

  // 4) task_attachments
  const srcAtt = await fetchIds(src, 'task_attachments', 'task_id', taskIds)
  const dstAtt = await fetchIds(dst, 'task_attachments', 'task_id', taskIds)
  relatedOk.push(diffSets('task_attachments', srcAtt, dstAtt).ok)

  // 5) wallet txs by task reference
  const srcWallet = await fetchIds(src, 'lawyer_wallet_transactions', 'reference_id', taskIds)
  const dstWallet = await fetchIds(dst, 'lawyer_wallet_transactions', 'reference_id', taskIds)
  relatedOk.push(diffSets('lawyer_wallet_transactions (by task)', srcWallet, dstWallet).ok)

  // 6) محمود الجبوري full wallet match
  const LAWYER = 'a4a1a8ef-4d6b-4795-88f0-989d5c19fcb6'
  const srcJw = await fetchRows(src, 'lawyer_wallet_transactions', 'lawyer_id', [LAWYER])
  const dstJw = await fetchRows(dst, 'lawyer_wallet_transactions', 'lawyer_id', [LAWYER])
  const jw = diffSets(
    'محمود الجبوري wallet txs (all)',
    new Set(srcJw.map(t => String(t.id))),
    new Set(dstJw.map(t => String(t.id))),
  )
  const srcFees = srcJw.filter(t => t.wallet === 'fees').reduce((s, t) => s + Number(t.amount || 0), 0)
  const dstFees = dstJw.filter(t => t.wallet === 'fees').reduce((s, t) => s + Number(t.amount || 0), 0)
  const srcSav = srcJw.filter(t => t.wallet === 'savings').reduce((s, t) => s + Number(t.amount || 0), 0)
  const dstSav = dstJw.filter(t => t.wallet === 'savings').reduce((s, t) => s + Number(t.amount || 0), 0)
  console.log(`   fees balance restore=${srcFees} prod=${dstFees} ${srcFees === dstFees ? '✅' : '❌'}`)
  console.log(`   savings balance restore=${srcSav} prod=${dstSav} ${srcSav === dstSav ? '✅' : '❌'}`)

  const allOk =
    d1.ok &&
    d2.ok &&
    debtorFieldMismatches.length === 0 &&
    taskFieldMismatches.length === 0 &&
    relatedOk.every(Boolean) &&
    jw.ok &&
    srcFees === dstFees &&
    srcSav === dstSav

  console.log('\n==============================')
  console.log(allOk ? 'النتيجة: الاسترجاع مطابق بالكامل ✅' : 'النتيجة: توجد فروقات ⚠️')
  console.log('==============================')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
