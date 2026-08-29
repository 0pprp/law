/**
 * من ملف إكسل الصرفيات: إرجاع «صرفيات تبليغ» لمحفظة المحامي ثم حذف البند من الزبون.
 *
 *   node --env-file=.env.local scripts/refund-excel-notification-expenses.mjs --dry-run
 *   node --env-file=.env.local scripts/refund-excel-notification-expenses.mjs --confirm
 *
 * افتراضي الملف:
 *   C:/Users/Marvel/Downloads/صرفيات-2026-08-05-2026-08-31.xlsx
 * أو مرّر المسار كأول وسيط غير علَم.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const dryRun = process.argv.includes('--dry-run')
const confirm = process.argv.includes('--confirm')
const excelPath =
  process.argv.find(a => a.endsWith('.xlsx') || a.endsWith('.xls')) ||
  'C:/Users/Marvel/Downloads/صرفيات-2026-08-05-2026-08-31.xlsx'

if (!dryRun && !confirm) {
  console.error('Use --dry-run or --confirm')
  process.exit(1)
}
if (!existsSync(excelPath)) {
  console.error('Excel not found:', excelPath)
  process.exit(1)
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

function norm(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseExcel(path) {
  const wb = XLSX.read(readFileSync(path))
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
  const out = []
  for (const r of rows) {
    if (!r || !r[0]) continue
    out.push({
      debtor: norm(r[0]),
      phone: norm(r[1]),
      lawyer: norm(r[3]),
      expense_type: norm(r[4]),
      note: norm(r[5]),
      amount: Number(r[6] || 0),
      date: norm(r[7]).slice(0, 10),
      status: norm(r[8]),
      task: norm(r[9]),
    })
  }
  return out.filter(x => x.expense_type === 'صرفيات تبليغ' || x.expense_type.includes('تبليغ'))
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

const excel = parseExcel(excelPath)
const dates = excel.map(e => e.date).filter(Boolean).sort()
const minDate = dates[0] || '2026-08-01'
const maxDate = dates[dates.length - 1] || '2026-08-31'

const { data: exps, error: expErr } = await admin
  .from('expenses')
  .select(
    'id, amount, expense_type, description, expense_date, status, wallet_deducted_at, lawyer_id, debtor_id, task_id, debtors(full_name), profiles:lawyer_id(full_name)',
  )
  .eq('expense_type', 'صرفيات تبليغ')
  .gte('expense_date', minDate)
  .lte('expense_date', maxDate)
if (expErr) throw new Error(expErr.message)

const used = new Set()
const matched = []
const unmatched = []

for (const x of excel) {
  if (x.amount <= 0) {
    unmatched.push({ ...x, reason: 'amount0' })
    continue
  }

  const sameNameAmount = (exps ?? []).filter(
    e =>
      !used.has(e.id) &&
      Number(e.amount) === x.amount &&
      norm(e.debtors?.full_name) === x.debtor,
  )

  let pick =
    sameNameAmount.find(
      e =>
        norm(e.expense_date).slice(0, 10) === x.date &&
        norm(e.profiles?.full_name) === x.lawyer,
    ) ||
    sameNameAmount.find(e => norm(e.expense_date).slice(0, 10) === x.date) ||
    sameNameAmount.find(e => norm(e.profiles?.full_name) === x.lawyer) ||
    sameNameAmount[0]

  if (!pick) {
    unmatched.push({ ...x, reason: 'no-db' })
    continue
  }
  used.add(pick.id)
  matched.push({ excel: x, exp: pick })
}

const refundTotal = matched.reduce((s, m) => s + Number(m.exp.amount || 0), 0)
const byLawyer = new Map()
for (const m of matched) {
  const name = norm(m.exp.profiles?.full_name) || m.exp.lawyer_id
  const cur = byLawyer.get(name) ?? { n: 0, sum: 0 }
  cur.n += 1
  cur.sum += Number(m.exp.amount || 0)
  byLawyer.set(name, cur)
}

console.log(dryRun ? '=== DRY RUN ===' : '=== APPLY ===')
console.log('Excel:', excelPath)
console.log(`Excel rows: ${excel.length} | matched amount>0: ${matched.length} | skipped/unmatched: ${unmatched.length}`)
console.log(`Refund total: ${refundTotal.toLocaleString('en-US')} IQD`)
console.log('\nBy lawyer:')
for (const [name, v] of [...byLawyer.entries()].sort((a, b) => b[1].sum - a[1].sum)) {
  console.log(`  ${name}: ${v.n} / ${v.sum.toLocaleString('en-US')}`)
}
const noDb = unmatched.filter(u => u.reason === 'no-db')
if (noDb.length) {
  console.log('\nUnmatched (no DB):')
  for (const u of noDb.slice(0, 20)) {
    console.log(`  ${u.debtor} | ${u.amount} | ${u.date} | ${u.lawyer}`)
  }
}

if (dryRun) {
  console.log('\nDry run only. Re-run with --confirm to refund + delete.')
  process.exit(noDb.length ? 1 : 0)
}

if (!matched.length) {
  console.log('Nothing to apply.')
  process.exit(0)
}

const actorId = await resolveActorId()
if (!actorId) throw new Error('No active admin')

let refunded = 0
let deleted = 0
const errors = []

for (const m of matched) {
  const e = m.exp
  const amount = Number(e.amount || 0)
  if (!e.lawyer_id || amount <= 0) {
    errors.push(`${e.id}: missing lawyer/amount`)
    continue
  }

  // idempotency: skip if already refunded for this expense id
  const { data: existingRefund } = await admin
    .from('lawyer_wallet_transactions')
    .select('id')
    .eq('reference_id', e.id)
    .eq('wallet', 'savings')
    .eq('type', 'manual_adjustment')
    .gt('amount', 0)
    .ilike('notes', '%إرجاع صرفيات تبليغ%')
    .maybeSingle()

  if (!existingRefund) {
    const notes = [
      'إرجاع صرفيات تبليغ من ملف الإكسل',
      `مدين: ${m.excel.debtor}`,
      `مصروف: ${e.id}`,
      `تاريخ: ${e.expense_date}`,
    ].join('\n')

    const { error: txErr } = await admin.from('lawyer_wallet_transactions').insert({
      lawyer_id: e.lawyer_id,
      wallet: 'savings',
      amount,
      type: 'manual_adjustment',
      notes,
      reference_id: e.id,
      created_by: actorId,
    })
    if (txErr) {
      errors.push(`${e.id} wallet: ${txErr.message}`)
      continue
    }
    refunded += amount
  } else {
    refunded += amount
  }

  const { error: delErr } = await admin.from('expenses').delete().eq('id', e.id)
  if (delErr) {
    errors.push(`${e.id} delete: ${delErr.message}`)
    continue
  }
  deleted += 1
}

// حذف بنود المبلغ 0 المطابقة للإكسل (نفس الاسم+تاريخ) إن وُجدت
let deletedZero = 0
for (const x of unmatched.filter(u => u.reason === 'amount0')) {
  const zeros = (exps ?? []).filter(
    e =>
      !used.has(e.id) &&
      Number(e.amount || 0) === 0 &&
      norm(e.debtors?.full_name) === x.debtor &&
      (!x.date || norm(e.expense_date).slice(0, 10) === x.date),
  )
  for (const z of zeros) {
    const { error } = await admin.from('expenses').delete().eq('id', z.id)
    if (!error) {
      used.add(z.id)
      deletedZero += 1
    }
  }
}

console.log(`\nRefunded: ${refunded.toLocaleString('en-US')} IQD`)
console.log(`Deleted expenses (>0): ${deleted}`)
console.log(`Deleted zero-amount rows: ${deletedZero}`)
if (errors.length) {
  console.log(`Errors (${errors.length}):`)
  for (const err of errors.slice(0, 30)) console.log(' ', err)
  process.exitCode = 1
} else {
  console.log('Done.')
}
