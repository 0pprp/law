/**
 * إصلاح مزامنة الصرفيات المعتمدة + تحقق أتعاب كل محامٍ مرتبط بالـ 38
 * Dry-run:  npx tsx --env-file=.env.local scripts/fix-restored-debtor-money.ts
 * Confirm:  npx tsx --env-file=.env.local scripts/fix-restored-debtor-money.ts --confirm
 */
import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const confirm = process.argv.includes('--confirm')
const report = JSON.parse(readFileSync('scripts/delete-return-to-payment-report.json', 'utf8')) as {
  deletedNames: { id: string; name: string }[]
}
const DEBTOR_IDS = report.deletedNames.map(d => d.id)
const nameById = new Map(report.deletedNames.map(d => [d.id, d.name]))

function client(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false } })
}

function money(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0
}

async function fetchAll(
  sb: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
  select = '*',
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40)
    const { data, error } = await sb.from(table).select(select).in(column, chunk)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as Record<string, unknown>[]))
  }
  return out
}

async function walletBalance(sb: SupabaseClient, lawyerId: string) {
  const { data } = await sb
    .from('lawyer_wallet_transactions')
    .select('amount, wallet, type')
    .eq('lawyer_id', lawyerId)
  const fees = (data ?? []).filter(t => t.wallet === 'fees').reduce((s, t) => s + money(t.amount), 0)
  const savings = (data ?? []).filter(t => t.wallet === 'savings').reduce((s, t) => s + money(t.amount), 0)
  return { fees, savings, count: data?.length ?? 0 }
}

async function main() {
  const dst = client(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const src = client(process.env.RESTORE_SUPABASE_URL!, process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY!)

  const expenses = await fetchAll(
    dst,
    'expenses',
    'debtor_id',
    DEBTOR_IDS,
    'id, debtor_id, amount, status, expense_type',
  )
  const debtors = await fetchAll(
    dst,
    'debtors',
    'id',
    DEBTOR_IDS,
    'id, full_name, total_expenses, required_amount, remaining_amount, lawyer_fees',
  )
  const srcDebtors = await fetchAll(
    src,
    'debtors',
    'id',
    DEBTOR_IDS,
    'id, total_expenses, required_amount, remaining_amount, lawyer_fees',
  )
  const srcDebtorMap = new Map(srcDebtors.map(d => [String(d.id), d]))

  console.log('=== حالة الصرفيات ===')
  const byStatus = new Map<string, number>()
  for (const e of expenses) {
    const s = String(e.status ?? 'null')
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1)
  }
  console.log('حسب الحالة:', Object.fromEntries(byStatus))

  // مجموع المعتمدة فقط (كما يفعل الـ trigger)
  const approvedSum = new Map<string, number>()
  const pendingSum = new Map<string, number>()
  for (const e of expenses) {
    const id = String(e.debtor_id)
    const amt = money(e.amount)
    const st = String(e.status ?? 'approved')
    if (st === 'approved') approvedSum.set(id, (approvedSum.get(id) ?? 0) + amt)
    else pendingSum.set(id, (pendingSum.get(id) ?? 0) + amt)
  }

  const syncNeeded: string[] = []
  for (const d of debtors) {
    const id = String(d.id)
    const name = String(d.full_name ?? nameById.get(id))
    const stored = money(d.total_expenses)
    const approved = approvedSum.get(id) ?? 0
    const pending = pendingSum.get(id) ?? 0
    const src = srcDebtorMap.get(id)
    const ok = stored === approved
    const matchRestore = src && money(src.total_expenses) === stored
    console.log(
      `${ok ? '✅' : '❌'} ${name}: total_expenses=${stored} | معتمدة=${approved} | قيد المراجعة=${pending}` +
        (matchRestore ? ' | مطابق للاسترجاع' : ` | استرجاع=${src ? money(src.total_expenses) : '—'}`),
    )
    if (!ok) syncNeeded.push(id)
  }

  // أتعاب المحامين المرتبطين
  console.log('\n=== أتعاب المحامين المرتبطين بالمهام المسترجعة ===')
  const tasks = await fetchAll(
    dst,
    'tasks',
    'debtor_id',
    DEBTOR_IDS,
    'id, assigned_to, reward_amount, fee_status, task_status',
  )
  const taskIds = tasks.map(t => String(t.id))
  const walletTxs = await fetchAll(
    dst,
    'lawyer_wallet_transactions',
    'reference_id',
    taskIds,
    'id, lawyer_id, amount, type, wallet, reference_id',
  )
  const srcWalletTxs = await fetchAll(
    src,
    'lawyer_wallet_transactions',
    'reference_id',
    taskIds,
    'id, lawyer_id, amount, type, wallet, reference_id',
  )

  const missingTx = srcWalletTxs.filter(s => !walletTxs.some(p => String(p.id) === String(s.id)))
  console.log(`حركات محفظة مرتبطة بالمهام: prod=${walletTxs.length} restore=${srcWalletTxs.length} ناقصة=${missingTx.length}`)

  const lawyerIds = [...new Set([
    ...tasks.map(t => t.assigned_to).filter(Boolean).map(String),
    ...walletTxs.map(t => String(t.lawyer_id)),
    ...srcWalletTxs.map(t => String(t.lawyer_id)),
  ])]

  const { data: lawyers } = lawyerIds.length
    ? await dst.from('profiles').select('id, full_name').in('id', lawyerIds)
    : { data: [] as { id: string; full_name: string }[] }
  const lawyerName = new Map((lawyers ?? []).map(l => [l.id, l.full_name]))

  let lawyerOk = true
  for (const lid of lawyerIds) {
    const [prodBal, restBal] = await Promise.all([
      walletBalance(dst, lid),
      walletBalance(src, lid),
    ])
    const feesOk = prodBal.fees === restBal.fees
    const savOk = prodBal.savings === restBal.savings
    const countOk = prodBal.count === restBal.count
    if (!feesOk || !savOk || !countOk) lawyerOk = false
    console.log(
      `${feesOk && savOk && countOk ? '✅' : '❌'} ${lawyerName.get(lid) ?? lid}: ` +
        `أتعاب ${prodBal.fees} (استرجاع ${restBal.fees}) | ` +
        `صرفيات ${prodBal.savings} (استرجاع ${restBal.savings}) | ` +
        `حركات ${prodBal.count}/${restBal.count}`,
    )
  }
  if (!lawyerIds.length) console.log('لا محامين مرتبطين')

  // lawyer_fees على المدين
  console.log('\n=== حقل lawyer_fees على المدينين ===')
  let lfOk = true
  for (const d of debtors) {
    const s = srcDebtorMap.get(String(d.id))
    if (!s) continue
    if (money(d.lawyer_fees) !== money(s.lawyer_fees)) {
      lfOk = false
      console.log(`❌ ${d.full_name}: prod=${d.lawyer_fees} restore=${s.lawyer_fees}`)
    }
  }
  if (lfOk) console.log('✅ كل قيم lawyer_fees مطابقة للاسترجاع')

  // مهام معتمدة بدون حركة أتعاب
  console.log('\n=== مهام وأتعاب ===')
  let taskFeeOk = true
  for (const t of tasks) {
    const reward = money(t.reward_amount)
    const status = String(t.task_status ?? '')
    const feeStatus = String(t.fee_status ?? '')
    const paid = walletTxs
      .filter(w => String(w.reference_id) === String(t.id) && w.type === 'approved_task_payment')
      .reduce((s, w) => s + money(w.amount), 0)
    if ((status === 'approved' || status === 'completed') && reward > 0 && paid === 0) {
      taskFeeOk = false
      console.log(`❌ مهمة معتمدة بلا أتعاب: ${nameById.get(String(t.debtor_id))} reward=${reward}`)
    } else if (paid > 0 && reward > 0 && paid !== reward) {
      taskFeeOk = false
      console.log(`❌ مبلغ أتعاب مختلف: ${nameById.get(String(t.debtor_id))} reward=${reward} paid=${paid}`)
    }
  }
  if (taskFeeOk) console.log('✅ أتعاب المهام المسترجعة متسقة')

  // إصلاح: إعادة قدح sync للصرفيات المعتمدة + إدخال حركات ناقصة
  if (!confirm) {
    console.log('\n--- ملخص ---')
    console.log(`صرفيات pending_review لا تدخل total_expenses (سلوك النظام) — ياسر حسين كاظم سليم بهذا المعنى`)
    console.log(`يحتاج إعادة مزامنة trigger: ${syncNeeded.length}`)
    console.log(`حركات محفظة ناقصة: ${missingTx.length}`)
    console.log(`أتعاب المحامين: ${lawyerOk ? 'سليمة' : 'فيها فروقات'}`)
    console.log('Dry-run. أعد مع --confirm لإعادة قدح المزامنة وإكمال أي نقص')
    return
  }

  // 1) قدح sync_debtor_total_expenses بتحديث بسيط على صرفية معتمدة لكل مدين يحتاج
  let synced = 0
  for (const debtorId of syncNeeded.length ? syncNeeded : DEBTOR_IDS) {
    const approved = expenses.find(
      e => String(e.debtor_id) === debtorId && String(e.status ?? 'approved') === 'approved',
    )
    if (!approved) continue
    const { error } = await dst
      .from('expenses')
      .update({ amount: money(approved.amount) }) // no-op value touch to fire UPDATE trigger
      .eq('id', String(approved.id))
    if (error) console.error(`sync fail ${debtorId}: ${error.message}`)
    else synced++
  }

  // 2) حركات محفظة ناقصة
  let inserted = 0
  for (const tx of missingTx) {
    const { error } = await dst.from('lawyer_wallet_transactions').insert(tx)
    if (error) console.error(`wallet ${tx.id}: ${error.message}`)
    else inserted++
  }

  // تحقق بعد الإصلاح
  console.log('\n=== بعد الإصلاح ===')
  const debtorsAfter = await fetchAll(
    dst,
    'debtors',
    'id',
    DEBTOR_IDS,
    'id, full_name, total_expenses',
  )
  for (const d of debtorsAfter) {
    const id = String(d.id)
    const approved = approvedSum.get(id) ?? 0
    const pending = pendingSum.get(id) ?? 0
    if (approved === 0 && pending === 0) continue
    const ok = money(d.total_expenses) === approved
    console.log(
      `${ok ? '✅' : '❌'} ${d.full_name}: total_expenses=${d.total_expenses} (معتمدة=${approved}, مراجعة=${pending})`,
    )
  }

  console.log(`\nDone. synced_triggers=${synced} wallet_inserted=${inserted}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
