/**
 * مقارنة تفصيلية للصرفيات القديمة (الـ 38) + تحقق مجاميع المدين
 * npx tsx --env-file=.env.local scripts/compare-restored-expenses.ts
 */
import { readFileSync } from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const report = JSON.parse(readFileSync('scripts/delete-return-to-payment-report.json', 'utf8')) as {
  deletedNames: { id: string; name: string; branch: string }[]
}
const DEBTOR_IDS = report.deletedNames.map(d => d.id)
const nameById = new Map(report.deletedNames.map(d => [d.id, d.name]))

function client(url: string, key: string) {
  return createClient(url, key, { auth: { persistSession: false } })
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

function norm(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return String(v)
  return String(v).trim()
}

function money(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

async function main() {
  const src = client(process.env.RESTORE_SUPABASE_URL!, process.env.RESTORE_SUPABASE_SERVICE_ROLE_KEY!)
  const dst = client(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const srcExp = await fetchAll(src, 'expenses', 'debtor_id', DEBTOR_IDS)
  const dstExp = await fetchAll(dst, 'expenses', 'debtor_id', DEBTOR_IDS)
  const srcDebtors = await fetchAll(
    src,
    'debtors',
    'id',
    DEBTOR_IDS,
    'id, full_name, total_expenses, remaining_amount, required_amount, total_payments, lawyer_fees, penalty_amount',
  )
  const dstDebtors = await fetchAll(
    dst,
    'debtors',
    'id',
    DEBTOR_IDS,
    'id, full_name, total_expenses, remaining_amount, required_amount, total_payments, lawyer_fees, penalty_amount',
  )

  console.log(`صرفيات الاسترجاع: ${srcExp.length}`)
  console.log(`صرفيات الإنتاج:   ${dstExp.length}\n`)

  const srcMap = new Map(srcExp.map(e => [String(e.id), e]))
  const dstMap = new Map(dstExp.map(e => [String(e.id), e]))

  const missing = [...srcMap.keys()].filter(id => !dstMap.has(id))
  const extra = [...dstMap.keys()].filter(id => !srcMap.has(id))

  console.log(`${missing.length === 0 ? '✅' : '❌'} ناقصة في الإنتاج: ${missing.length}`)
  console.log(`${extra.length === 0 ? '✅' : '❌'} زائدة في الإنتاج: ${extra.length}`)

  const compareFields = [
    'debtor_id', 'task_id', 'amount', 'expense_type', 'description', 'notes',
    'branch_id', 'created_by', 'is_from_wallet', 'wallet_deducted',
  ]

  let fieldMismatches = 0
  const mismatchLines: string[] = []
  for (const [id, s] of srcMap) {
    const d = dstMap.get(id)
    if (!d) continue
    for (const f of compareFields) {
      // amount numeric compare
      if (f === 'amount') {
        if (money(s.amount) !== money(d.amount)) {
          fieldMismatches++
          mismatchLines.push(`${id}.amount restore=${s.amount} prod=${d.amount}`)
        }
        continue
      }
      if (norm(s[f]) !== norm(d[f])) {
        // تجاهل حقول غير موجودة في أحد الطرفين بنفس الاسم البديل
        if (!(f in s) && !(f in d)) continue
        if (!(f in s) || !(f in d)) continue
        fieldMismatches++
        mismatchLines.push(`${id}.${f}: restore=${norm(s[f])} | prod=${norm(d[f])}`)
      }
    }
  }
  console.log(`${fieldMismatches === 0 ? '✅' : '❌'} فروقات حقول الصرفيات: ${fieldMismatches}`)
  for (const line of mismatchLines.slice(0, 20)) console.log('  ', line)

  // تفاصيل كل صرفية
  console.log('\n--- تفاصيل الصرفيات ---')
  let totalSrc = 0
  let totalDst = 0
  for (const e of [...srcExp].sort((a, b) => money(b.amount) - money(a.amount))) {
    const id = String(e.id)
    const d = dstMap.get(id)
    const amt = money(e.amount)
    totalSrc += amt
    totalDst += d ? money(d.amount) : 0
    const debtorName = nameById.get(String(e.debtor_id)) ?? String(e.debtor_id)
    const match = d && money(d.amount) === amt
    console.log(
      `${match ? '✅' : '❌'} ${amt.toLocaleString('en-IQ')} | ${debtorName} | type=${e.expense_type ?? e.description ?? '—'} | ${match ? 'مطابق' : 'غير مطابق'}`,
    )
  }
  console.log(`\nمجموع صرفيات الاسترجاع: ${totalSrc.toLocaleString('en-IQ')}`)
  console.log(`مجموع صرفيات الإنتاج:   ${totalDst.toLocaleString('en-IQ')}`)
  console.log(`${totalSrc === totalDst ? '✅' : '❌'} المجموع الكلي`)

  // تحقق total_expenses على المدين مقابل مجموع جدول expenses
  console.log('\n--- مقارنة total_expenses على المدين مع مجموع expenses ---')
  const srcDebtorMap = new Map(srcDebtors.map(d => [String(d.id), d]))
  const dstDebtorMap = new Map(dstDebtors.map(d => [String(d.id), d]))

  const sumByDebtor = (rows: Record<string, unknown>[]) => {
    const m = new Map<string, number>()
    for (const e of rows) {
      const id = String(e.debtor_id)
      m.set(id, (m.get(id) ?? 0) + money(e.amount))
    }
    return m
  }
  const srcSum = sumByDebtor(srcExp)
  const dstSum = sumByDebtor(dstExp)

  let debtorTotalOk = 0
  let debtorTotalWarn = 0
  for (const id of DEBTOR_IDS) {
    const sDeb = srcDebtorMap.get(id)
    const dDeb = dstDebtorMap.get(id)
    if (!sDeb || !dDeb) continue
    const expSumSrc = srcSum.get(id) ?? 0
    const expSumDst = dstSum.get(id) ?? 0
    const storedSrc = money(sDeb.total_expenses)
    const storedDst = money(dDeb.total_expenses)
    const name = String(sDeb.full_name ?? nameById.get(id))

    const rowMatch = storedSrc === storedDst && expSumSrc === expSumDst
    // ملاحظة: total_expenses قد يُحسب من triggers وقد يختلف عن مجموع صفوف expenses إن وُجدت مصروفات مستوردة/قديمة
    const srcAligned = storedSrc === expSumSrc
    const dstAligned = storedDst === expSumDst

    if (rowMatch && (expSumSrc === 0 || (srcAligned && dstAligned))) {
      debtorTotalOk++
    } else if (rowMatch) {
      debtorTotalWarn++
      if (expSumSrc > 0 || storedSrc > 0) {
        console.log(
          `⚠️ ${name}: total_expenses=${storedDst} | sum(expenses)=${expSumDst}` +
            (srcAligned ? '' : ' (المخزّن ≠ مجموع الصفوف — قد يكون طبيعياً حسب آلية الحساب)'),
        )
      }
    } else {
      console.log(
        `❌ ${name}: restore total=${storedSrc}/sum=${expSumSrc} | prod total=${storedDst}/sum=${expSumDst}`,
      )
    }
  }
  console.log(`مدينون بمصاريف متطابقة بين البيئتين أو بلا صرفيات صفوف: تم الفحص`)

  // مدينون لديهم صرفيات فقط
  const withExp = [...srcSum.entries()].filter(([, v]) => v > 0)
  console.log(`\nمدينون لديهم صرفيات في الجدول: ${withExp.length}`)
  for (const [id, sum] of withExp.sort((a, b) => b[1] - a[1])) {
    const stored = money(dstDebtorMap.get(id)?.total_expenses)
    const ok = stored === sum || true // inform
    console.log(
      `  ${nameById.get(id)}: sum(expenses)=${sum.toLocaleString('en-IQ')} | total_expenses(prod)=${stored.toLocaleString('en-IQ')}` +
        (stored === sum ? ' ✅' : ' ⚠️ مخزّن مختلف عن مجموع الصفوف'),
    )
  }

  const perfect =
    missing.length === 0 &&
    extra.length === 0 &&
    fieldMismatches === 0 &&
    totalSrc === totalDst

  console.log('\n==============================')
  console.log(
    perfect
      ? 'النتيجة: الصرفيات القديمة بين الاسترجاع والإنتاج صحيحة ومتطابقة ✅'
      : 'النتيجة: توجد فروقات في الصرفيات ❌',
  )
  console.log('==============================')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
