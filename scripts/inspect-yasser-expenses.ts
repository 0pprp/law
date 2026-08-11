import { createClient } from '@supabase/supabase-js'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

async function main() {
  const id = '9eb0c36b-8e1d-431b-b7a2-e4250501bb12'
  const { data: ex, error } = await sb
    .from('expenses')
    .select('id, amount, status, expense_type, description, task_id, created_at')
    .eq('debtor_id', id)
  console.log('err', error?.message)
  console.log(JSON.stringify(ex, null, 2))
  const { data: d } = await sb
    .from('debtors')
    .select('id, full_name, total_expenses, required_amount, remaining_amount, receipt_amount, penalty_amount, lawyer_fees')
    .eq('id', id)
    .single()
  console.log('debtor', d)

  // كل صرفيات الـ 38 وحالاتها
  const report = JSON.parse(
    require('fs').readFileSync('scripts/delete-return-to-payment-report.json', 'utf8'),
  )
  const ids = report.deletedNames.map((x: { id: string }) => x.id)
  const { data: all } = await sb.from('expenses').select('id, debtor_id, amount, status').in('debtor_id', ids)
  const byStatus = new Map<string, number>()
  for (const e of all ?? []) {
    const s = String(e.status ?? 'null')
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1)
  }
  console.log('all restored expenses by status:', Object.fromEntries(byStatus))
}

main().catch(console.error)
