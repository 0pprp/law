/**
 * إرجاع «صرفيات تبليغ» لأسماء حالياً في مرحلة المرافعات إلى محفظة صرفيات المحامي،
 * ثم تصفير مبلغ بند الصرفية (لا يمس رسم الدعوى أو غيرها).
 *
 * النطاق الافتراضي: مدينون current_task = مرافعات (pleading)
 * فقط expense_type = «صرفيات تبليغ» و status=approved ومخصومة من المحفظة.
 *
 *   node --env-file=.env.local scripts/refund-pleading-notification-expenses.mjs --dry-run
 *   node --env-file=.env.local scripts/refund-pleading-notification-expenses.mjs --confirm
 */
import { createClient } from '@supabase/supabase-js'

const EXPENSE_TYPE = 'صرفيات تبليغ'
const dryRun = process.argv.includes('--dry-run')
const confirm = process.argv.includes('--confirm')

if (!dryRun && !confirm) {
  console.error('Use --dry-run or --confirm')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing Supabase env')
  process.exit(1)
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function getPleadingDebtorIds() {
  const { data: pdefs, error } = await admin
    .from('task_definitions')
    .select('id')
    .eq('task_type', 'pleading')
  if (error) throw new Error(error.message)
  const defIds = new Set((pdefs ?? []).map(d => d.id))

  const { data: debtors, error: dErr } = await admin
    .from('debtors')
    .select('id, full_name, current_task_id')
    .not('current_task_id', 'is', null)
  if (dErr) throw new Error(dErr.message)

  const curIds = [...new Set((debtors ?? []).map(d => d.current_task_id).filter(Boolean))]
  const pleadTaskSet = new Set()
  for (let i = 0; i < curIds.length; i += 200) {
    const { data } = await admin
      .from('tasks')
      .select('id, task_definition_id')
      .in('id', curIds.slice(i, i + 200))
    for (const t of data ?? []) {
      if (defIds.has(t.task_definition_id)) pleadTaskSet.add(t.id)
    }
  }

  return (debtors ?? []).filter(d => pleadTaskSet.has(d.current_task_id))
}

async function loadTargetExpenses(debtorIds) {
  const rows = []
  for (let i = 0; i < debtorIds.length; i += 100) {
    const chunk = debtorIds.slice(i, i + 100)
    const { data, error } = await admin
      .from('expenses')
      .select(
        'id, amount, status, wallet_deducted_at, lawyer_id, debtor_id, task_id, expense_type, description',
      )
      .in('debtor_id', chunk)
      .eq('expense_type', EXPENSE_TYPE)
      .eq('status', 'approved')
      .not('wallet_deducted_at', 'is', null)
      .gt('amount', 0)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
  }
  return rows
}

async function resolveActorId() {
  const { data } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

const pleadingDebtors = await getPleadingDebtorIds()
const debtorName = Object.fromEntries(pleadingDebtors.map(d => [d.id, d.full_name]))
const expenses = await loadTargetExpenses(pleadingDebtors.map(d => d.id))

const byLawyer = new Map()
for (const e of expenses) {
  const lid = e.lawyer_id
  if (!lid) continue
  const cur = byLawyer.get(lid) ?? { n: 0, sum: 0 }
  cur.n += 1
  cur.sum += Number(e.amount || 0)
  byLawyer.set(lid, cur)
}

const lawyerIds = [...byLawyer.keys()]
const { data: lawyers } = await admin
  .from('profiles')
  .select('id, full_name, username')
  .in('id', lawyerIds.length ? lawyerIds : ['00000000-0000-0000-0000-000000000000'])
const lawyerName = Object.fromEntries(
  (lawyers ?? []).map(p => [p.id, p.full_name || p.username || p.id]),
)

const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
console.log(dryRun ? '=== DRY RUN ===' : '=== CONFIRM APPLY ===')
console.log(`Debtors in pleading: ${pleadingDebtors.length}`)
console.log(`Target expenses (${EXPENSE_TYPE}, approved+deducted): ${expenses.length}`)
console.log(`Total to refund: ${total.toLocaleString('en-US')} IQD`)
console.log('\nBy lawyer:')
for (const [id, v] of byLawyer) {
  console.log(`  ${lawyerName[id] ?? id}: ${v.n} rows / ${v.sum.toLocaleString('en-US')}`)
}

if (dryRun) {
  console.log('\nSample (up to 15):')
  for (const e of expenses.slice(0, 15)) {
    console.log(
      `  ${debtorName[e.debtor_id] ?? e.debtor_id} | ${Number(e.amount).toLocaleString('en-US')} | ${lawyerName[e.lawyer_id] ?? e.lawyer_id}`,
    )
  }
  console.log('\nDry run only. Re-run with --confirm to refund + zero amounts.')
  process.exit(0)
}

if (!expenses.length) {
  console.log('Nothing to do.')
  process.exit(0)
}

const actorId = await resolveActorId()
if (!actorId) throw new Error('No active admin for created_by')

let refunded = 0
let zeroed = 0
const errors = []

for (const e of expenses) {
  const amount = Number(e.amount || 0)
  if (!e.lawyer_id || amount <= 0) {
    errors.push(`${e.id}: missing lawyer/amount`)
    continue
  }

  const note = [
    'إرجاع صرفيات تبليغ — أسماء في المرافعات',
    `مدين: ${debtorName[e.debtor_id] ?? e.debtor_id}`,
    `مصروف: ${e.id}`,
    `مهمة: ${e.task_id ?? '—'}`,
  ].join('\n')

  const { error: txErr } = await admin.from('lawyer_wallet_transactions').insert({
    lawyer_id: e.lawyer_id,
    wallet: 'savings',
    amount,
    type: 'manual_adjustment',
    notes: note,
    reference_id: e.id,
    created_by: actorId,
  })
  if (txErr) {
    errors.push(`${e.id} wallet: ${txErr.message}`)
    continue
  }
  refunded += amount

  const { error: zErr } = await admin
    .from('expenses')
    .update({
      amount: 0,
      description: [e.description, `[أُرجع ${amount.toLocaleString('en-US')} لمحفظة الصرفيات — مرافعات]`]
        .filter(Boolean)
        .join(' | '),
    })
    .eq('id', e.id)
  if (zErr) {
    errors.push(`${e.id} zero: ${zErr.message}`)
    continue
  }
  zeroed += 1
}

console.log(`\nRefunded: ${refunded.toLocaleString('en-US')} IQD`)
console.log(`Zeroed expense rows: ${zeroed}`)
if (errors.length) {
  console.log(`Errors (${errors.length}):`)
  for (const err of errors.slice(0, 20)) console.log(' ', err)
  process.exitCode = 1
} else {
  console.log('Done.')
}
