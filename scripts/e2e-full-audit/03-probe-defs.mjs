import { serviceClient, BRANCH_ID } from './lib.mjs'
const svc = serviceClient()

const { data: defs } = await svc
  .from('task_definitions')
  .select('id, label, task_type, fee_amount, is_active, is_hybrid, allows_expenses, case_type, task_required_fields(field_key, field_label, field_type, is_required), task_definition_expenses(id, name, max_amount)')
  .eq('branch_id', BRANCH_ID)
  .eq('case_type', 'civil')
  .eq('is_active', true)
  .order('sort_order')

for (const d of defs ?? []) {
  console.log(`${d.id} | ${d.label} | fee=${d.fee_amount} | hybrid=${d.is_hybrid} | allowsExp=${d.allows_expenses} | fields=${(d.task_required_fields ?? []).map(f => f.field_key + ':' + f.field_type).join(',')} | expenses=${(d.task_definition_expenses ?? []).map(e => e.name + '<=' + e.max_amount).join(',')}`)
}

const { data: links } = await svc.from('task_definition_links').select('*').limit(5)
console.log('task_definition_links sample:', JSON.stringify(links))
