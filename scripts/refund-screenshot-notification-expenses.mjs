/**
 * إرجاع/حذف صرفيات تبليغ لأسماء من لقطات الشاشة (2026-08-11 و 2026-08-12).
 *   node --env-file=.env.local scripts/refund-screenshot-notification-expenses.mjs --dry-run
 *   node --env-file=.env.local scripts/refund-screenshot-notification-expenses.mjs --confirm
 */
import { createClient } from '@supabase/supabase-js'

const dryRun = process.argv.includes('--dry-run')
const confirm = process.argv.includes('--confirm')
if (!dryRun && !confirm) {
  console.error('Use --dry-run or --confirm')
  process.exit(1)
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

/** أسماء من الصور (مع بدائل محتملة) */
const NAME_QUERIES = [
  'فلاح عبد الحسن عبد الحمزة',
  'حسن علي صائب',
  'ليث حسون حمزة',
  'علي حسن حجارة',
  'كاظم حميد حمزة',
  'يوسف يحيى محمد علي',
  'ليث ماجد خضير',
  'حسن هادي شمخي',
  'زيد عبد الكريم ياسين',
  'نجلاء جبار سويف',
  'علي جاسم محمد 6',
  'ضرغام رضا عباس 4',
  'حسين عدي محمد 2',
  'عباس جمعة عبدالله',
  'عباس جمعة عبد الله',
  'احمد صبحي ناجي',
  'حسنين حسن جاسم',
  'حيدر ناصر حميد',
  'محمد باسم خضير',
  'بشار محمد عباس',
  'صادق باسل كاظم',
  'احمد ماهر بدري',
  'إبراهيم محمد كامل',
  'ابراهيم محمد كامل',
  'يوسف نوري عبادي',
  'محمد فاضل عبيد',
  'لؤي خزعل زويد',
  'ثامر عبد الحسين',
  'مصطفى عبد الرضا',
  'محمد علي محسن',
  'حسن زيد علاوي',
]

function norm(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function resolveDebtors() {
  const found = new Map()
  for (const q of NAME_QUERIES) {
    const { data, error } = await admin
      .from('debtors')
      .select('id, full_name')
      .ilike('full_name', `%${q}%`)
      .limit(10)
    if (error) throw new Error(error.message)
    for (const d of data ?? []) found.set(d.id, d.full_name)
  }
  return [...found.entries()].map(([id, full_name]) => ({ id, full_name }))
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

const debtors = await resolveDebtors()
console.log(`Debtors matched: ${debtors.length}`)
for (const d of debtors) console.log(`  ${d.full_name}`)

const ids = debtors.map(d => d.id)
let expenses = []
for (let i = 0; i < ids.length; i += 50) {
  const { data, error } = await admin
    .from('expenses')
    .select(
      'id, amount, expense_type, expense_date, status, wallet_deducted_at, lawyer_id, debtor_id, description, debtors(full_name), profiles:lawyer_id(full_name)',
    )
    .in('debtor_id', ids.slice(i, i + 50))
    .eq('expense_type', 'صرفيات تبليغ')
  if (error) throw new Error(error.message)
  expenses = expenses.concat(data ?? [])
}

// فلترة تواريخ الصور تقريباً 11-12 آب، مع الإبقاء على أي تبليغ متبقٍ لهؤلاء الأسماء
const target = expenses.filter(e => {
  const d = String(e.expense_date || '').slice(0, 10)
  return d >= '2026-08-11' && d <= '2026-08-12'
})

const withAmount = target.filter(e => Number(e.amount) > 0)
const deducted = withAmount.filter(e => e.wallet_deducted_at)
const zeros = target.filter(e => Number(e.amount) <= 0)
const refundSum = deducted.reduce((s, e) => s + Number(e.amount || 0), 0)

const byLawyer = new Map()
for (const e of deducted) {
  const name = norm(e.profiles?.full_name) || e.lawyer_id
  const cur = byLawyer.get(name) ?? { n: 0, sum: 0 }
  cur.n += 1
  cur.sum += Number(e.amount || 0)
  byLawyer.set(name, cur)
}

console.log(dryRun ? '\n=== DRY RUN ===' : '\n=== APPLY ===')
console.log(
  `Target rows Aug 11-12: ${target.length} (deducted>0: ${deducted.length}, amount>0 not deducted: ${withAmount.length - deducted.length}, zero: ${zeros.length})`,
)
console.log(`Refund total (deducted only): ${refundSum.toLocaleString('en-US')} IQD`)
console.log('By lawyer:')
for (const [n, v] of byLawyer) console.log(`  ${n}: ${v.n} / ${v.sum.toLocaleString('en-US')}`)
console.log('\nRows:')
for (const e of target) {
  console.log(
    `  ${e.debtors?.full_name} | ${e.profiles?.full_name} | ${Number(e.amount).toLocaleString('en-US')} | ${e.expense_date} | deducted=${Boolean(e.wallet_deducted_at)}`,
  )
}

if (dryRun) {
  console.log('\nDry run only.')
  process.exit(0)
}

const actorId = await resolveActorId()
if (!actorId) throw new Error('No admin')

let refunded = 0
let deleted = 0
const errors = []

for (const e of target) {
  const amount = Number(e.amount || 0)

  // أرجع للمحفظة فقط إن خُصم فعلاً — غير المخصوم يُحذف فقط من المدين
  if (amount > 0 && e.lawyer_id && e.wallet_deducted_at) {
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
        'إرجاع صرفيات تبليغ من شاشة الصرفيات',
        `مدين: ${e.debtors?.full_name ?? e.debtor_id}`,
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
    }
    refunded += amount
  }

  const { error: delErr } = await admin.from('expenses').delete().eq('id', e.id)
  if (delErr) {
    errors.push(`${e.id} delete: ${delErr.message}`)
    continue
  }
  deleted += 1
}

console.log(`\nRefunded: ${refunded.toLocaleString('en-US')} IQD`)
console.log(`Deleted: ${deleted}`)
if (errors.length) {
  console.log('Errors:')
  for (const e of errors) console.log(' ', e)
  process.exitCode = 1
} else {
  console.log('Done.')
}
